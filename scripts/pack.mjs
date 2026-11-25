#!/usr/bin/env node
/**
 * 校验并打包 plugins/<dir>/ 下的定时任务插件为 `{id}-{version}-task-script.zip` + `.sha256`。
 * 零外部依赖，仅使用 Node.js 标准库（node:fs / node:crypto / node:zlib）。
 *
 * 用法：
 *   node scripts/pack.mjs [pluginDirs...] [--key <私钥.json>] [--require-signature] [--check-only]
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PLUGINS_DIR = path.join(ROOT, 'plugins')
const DIST_DIR = path.join(ROOT, 'dist')
const HEADER_RE = /\/\*\s*@agent2api-task-plugin\s*([\s\S]*?)\*\//
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const MAX_ZIP_BYTES = 2 * 1024 * 1024

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

function parseCliArgs(argv) {
  const targets = []
  let keyArg = ''
  let requireSignature = false
  let checkOnly = false

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--require-signature') {
      requireSignature = true
    } else if (token === '--check-only') {
      checkOnly = true
    } else if (token === '--key') {
      const next = argv[i + 1]
      if (!next || next.startsWith('--')) throw new Error('--key 缺少密钥文件路径')
      keyArg = next
      i += 1
    } else if (token.startsWith('--key=')) {
      keyArg = token.slice('--key='.length)
      if (!keyArg) throw new Error('--key 缺少密钥文件路径')
    } else if (token.startsWith('--')) {
      throw new Error(`未知参数：${token}`)
    } else {
      targets.push(token)
    }
  }
  return { targets, keyArg, requireSignature, checkOnly }
}

function loadSigningKey(keyArg) {
  let parsed = null
  if (keyArg) {
    const abs = path.resolve(keyArg)
    if (!fs.existsSync(abs)) throw new Error(`找不到签名密钥文件：${abs}`)
    parsed = JSON.parse(fs.readFileSync(abs, 'utf8'))
  } else if (process.env.AGENT2API_PLUGIN_KEY) {
    const raw = process.env.AGENT2API_PLUGIN_KEY.trim()
    if (raw.startsWith('{')) {
      parsed = JSON.parse(raw)
    } else {
      const abs = path.resolve(raw)
      if (!fs.existsSync(abs)) throw new Error(`找不到 AGENT2API_PLUGIN_KEY 指向的文件：${abs}`)
      parsed = JSON.parse(fs.readFileSync(abs, 'utf8'))
    }
  } else if (process.env.AGENT2API_PLUGIN_KEY_PEM) {
    parsed = {
      keyId: process.env.AGENT2API_PLUGIN_KEY_ID || 'official-2026',
      privateKeyPem: process.env.AGENT2API_PLUGIN_KEY_PEM,
    }
  }

  if (!parsed) return null
  const keyId = String(parsed.keyId || parsed.key_id || '').trim()
  const privateKeyPem = String(parsed.privateKeyPem || '').trim()
  if (!keyId || !privateKeyPem) {
    throw new Error('签名密钥格式无效：需要包含 keyId 与 privateKeyPem')
  }
  return { keyId, privateKey: crypto.createPrivateKey(privateKeyPem) }
}

function signScript(id, version, scriptText, signingKey) {
  if (!signingKey) return null
  const scriptSha = sha256Hex(Buffer.from(scriptText, 'utf8'))
  const payload = Buffer.from(`task-script-v1\n${id}\n${version}\n${scriptSha}`, 'utf8')
  const sig = crypto.sign(null, payload, signingKey.privateKey)
  return { algorithm: 'ed25519', key_id: signingKey.keyId, value: sig.toString('base64') }
}

function validateAndPackPlugin(dirName, signingKey, options) {
  const dir = path.join(PLUGINS_DIR, dirName)
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error(`找不到插件目录：plugins/${dirName}`)
  }
  const scriptPath = path.join(dir, 'script.js')
  const packPath = path.join(dir, 'pack.json')
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`${dirName}: missing script.js`)
  }

  const scriptText = fs.readFileSync(scriptPath, 'utf8')
  const match = HEADER_RE.exec(scriptText)
  if (!match) throw new Error(`${dirName}: missing /* @agent2api-task-plugin ... */ header`)
  const meta = JSON.parse(match[1])

  const expectedId = `agent2api-task-${dirName}`
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(meta.id || '')) {
    throw new Error(`${dirName}: invalid plugin id "${meta.id}"`)
  }
  if (meta.id !== expectedId) {
    throw new Error(`${dirName}: plugin id "${meta.id}" must equal "${expectedId}"`)
  }
  if (!meta.name || !meta.version) {
    throw new Error(`${dirName}: name and version are required`)
  }
  if (!SEMVER_RE.test(meta.version)) {
    throw new Error(`${dirName}: invalid semver "${meta.version}"`)
  }

  // 基础语法校验（把 export 规整后通过 Function 构造器检查语法）
  const body = scriptText.replace(HEADER_RE, '').replace(/^\s*export\s+(?=(?:async\s+)?function\b|const\b|let\b|var\b)/gm, '')
  new Function(`return (async () => {\n${body}\n});`)

  const manifest = fs.existsSync(packPath) ? JSON.parse(fs.readFileSync(packPath, 'utf8')) : {}
  if (manifest.id && manifest.id !== meta.id) {
    throw new Error(`${dirName}: pack.json id "${manifest.id}" != script.js id "${meta.id}"`)
  }
  if (manifest.version && manifest.version !== meta.version) {
    throw new Error(`${dirName}: pack.json version "${manifest.version}" != script.js version "${meta.version}"`)
  }
  if (manifest.category && manifest.category !== 'scheduled_task') {
    throw new Error(`${dirName}: pack.json category must be "scheduled_task"`)
  }
  if (manifest.target && manifest.target !== 'task-script') {
    throw new Error(`${dirName}: pack.json target must be "task-script"`)
  }
  if (manifest.entry && manifest.entry !== 'script.js') {
    throw new Error(`${dirName}: pack.json entry must be "script.js"`)
  }

  if (options.checkOnly) {
    console.log(`[check-ok] ${dirName} (${meta.id} v${meta.version})`)
    return
  }

  const packJson = {
    ...manifest,
    id: meta.id,
    name: meta.name,
    version: meta.version,
    category: 'scheduled_task',
    target: 'task-script',
    entry: 'script.js',
  }
  const signature = signScript(meta.id, meta.version, scriptText, signingKey)
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

  const zipName = `${meta.id}-${meta.version}-task-script.zip`
  const zipBuf = buildZip(entries)
  if (zipBuf.length > MAX_ZIP_BYTES) {
    throw new Error(`${dirName}: zip archive exceeds ${MAX_ZIP_BYTES} bytes limit (${zipBuf.length} bytes)`)
  }

  fs.mkdirSync(DIST_DIR, { recursive: true })
  const zipPath = path.join(DIST_DIR, zipName)
  fs.writeFileSync(zipPath, zipBuf)

  const digest = sha256Hex(zipBuf)
  fs.writeFileSync(`${zipPath}.sha256`, `${digest}  ${zipName}\n`, 'utf8')
  console.log(`[ok] ${zipName} (${zipBuf.length} bytes, sha256=${digest.slice(0, 12)}..., signed=${Boolean(signature)})`)
}

const options = parseCliArgs(process.argv.slice(2))
const signingKey = loadSigningKey(options.keyArg)
if (options.requireSignature && !signingKey) {
  throw new Error('已启用 --require-signature，但未提供可用的官方签名密钥')
}

const dirs = options.targets.length > 0
  ? options.targets
  : fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)

if (dirs.length === 0) {
  throw new Error('plugins/ 下没有可打包的定时任务插件')
}

for (const dir of dirs) validateAndPackPlugin(dir, signingKey, options)
