#!/usr/bin/env node
/**
 * 校验并打包 plugins/<dir>/ 下的定时任务插件为 `{id}-{version}-task-script.zip` + `.sha256`。
 * 零外部依赖，仅使用 Node.js 标准库（node:fs / node:crypto / node:zlib）。
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PLUGINS_DIR = path.join(ROOT, 'plugins')
const DIST_DIR = path.join(ROOT, 'dist')
const HEADER_RE = /\/\*\s*@agent2api-task-plugin\s*([\s\S]*?)\*\//

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    table[i] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function buildZip(entries) {
  const localParts = []
  const centralParts = []
  let offset = 0

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8')
    const rawBuf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8')
    const compressed = zlib.deflateRawSync(rawBuf, { level: 9 })
    const crc = crc32(rawBuf)

    const local = Buffer.alloc(30 + nameBuf.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(8, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(rawBuf.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    nameBuf.copy(local, 30)
    localParts.push(local, compressed)

    const central = Buffer.alloc(46 + nameBuf.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(rawBuf.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    nameBuf.copy(central, 46)
    centralParts.push(central)

    offset += local.length + compressed.length
  }

  const centralBuf = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBuf.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([...localParts, centralBuf, end])
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

function signScript(id, version, scriptText) {
  const pem = process.env.AGENT2API_PLUGIN_KEY_PEM
  const keyId = process.env.AGENT2API_PLUGIN_KEY_ID || 'official-2026'
  if (!pem) return null
  const scriptSha = sha256Hex(Buffer.from(scriptText, 'utf8'))
  const payload = Buffer.from(`task-script-v1\n${id}\n${version}\n${scriptSha}`, 'utf8')
  const sig = crypto.sign(null, payload, crypto.createPrivateKey(pem))
  return { algorithm: 'ed25519', key_id: keyId, value: sig.toString('base64') }
}

function packPlugin(dirName) {
  const dir = path.join(PLUGINS_DIR, dirName)
  const scriptPath = path.join(dir, 'script.js')
  const packPath = path.join(dir, 'pack.json')
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`${dirName}: missing script.js`)
  }

  const scriptText = fs.readFileSync(scriptPath, 'utf8')
  const match = HEADER_RE.exec(scriptText)
  if (!match) throw new Error(`${dirName}: missing /* @agent2api-task-plugin ... */ header`)
  const meta = JSON.parse(match[1])

  if (!/^[a-z][a-z0-9-]{0,63}$/.test(meta.id || '')) {
    throw new Error(`${dirName}: invalid plugin id "${meta.id}"`)
  }
  if (!meta.name || !meta.version) {
    throw new Error(`${dirName}: name and version are required`)
  }

  // 基础语法校验（把 export 规整后通过 Function 构造器检查语法）
  const body = scriptText.replace(HEADER_RE, '').replace(/^\s*export\s+(?=(?:async\s+)?function\b|const\b|let\b|var\b)/gm, '')
  new Function(`return (async () => {\n${body}\n});`)

  const manifest = fs.existsSync(packPath) ? JSON.parse(fs.readFileSync(packPath, 'utf8')) : {}
  const packJson = {
    ...manifest,
    id: meta.id,
    name: meta.name,
    version: meta.version,
    category: 'scheduled_task',
    target: 'task-script',
    entry: 'script.js',
  }
  const signature = signScript(meta.id, meta.version, scriptText)
  if (signature) packJson.signature = signature

  const entries = [
    { name: 'pack.json', data: `${JSON.stringify(packJson, null, 2)}\n` },
    { name: 'script.js', data: scriptText },
  ]
  for (const iconName of ['icon.png', 'icon.webp', 'icon.svg']) {
    const iconFile = path.join(dir, iconName)
    if (fs.existsSync(iconFile)) {
      entries.push({ name: iconName, data: fs.readFileSync(iconFile) })
      break
    }
  }

  fs.mkdirSync(DIST_DIR, { recursive: true })
  const zipName = `${meta.id}-${meta.version}-task-script.zip`
  const zipBuf = buildZip(entries)
  const zipPath = path.join(DIST_DIR, zipName)
  fs.writeFileSync(zipPath, zipBuf)

  const digest = sha256Hex(zipBuf)
  fs.writeFileSync(`${zipPath}.sha256`, `${digest}  ${zipName}\n`, 'utf8')
  console.log(`[ok] ${zipName} (${zipBuf.length} bytes, sha256=${digest.slice(0, 12)}..., signed=${Boolean(signature)})`)
}

const dirs = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name)

for (const dir of dirs) packPlugin(dir)
