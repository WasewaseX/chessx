// Asset generation with per-image timeout + retries, resumable.
import ZAI from 'z-ai-web-dev-sdk'
import sharp from 'sharp'
import fs from 'fs'
import path from 'path'

const BOTS = [
  { id: 'maple', look: 'a kind grandmother rook character, tower-shaped body, round glasses, knitted autumn scarf, warm smile', bg: '#c98f4e' },
  { id: 'squire', look: 'an eager young squire knight character with a round steel helmet visor up, freckles, big excited eyes', bg: '#7fa650' },
  { id: 'rex', look: 'a feisty bulldog character wearing a tiny golden crown, wrinkled snarl that is more funny than scary', bg: '#c04a3a' },
  { id: 'sentry', look: 'a vigilant owl character in a night watchman coat, holding a small lantern, sharp watchful eyes', bg: '#5d9948' },
  { id: 'vanguard', look: 'a brave pawn soldier character with a round wooden shield and a plume helmet, determined grin', bg: '#4f8f4a' },
  { id: 'fortress', look: 'a gruff stone castle golem character with battlement crenellations like eyebrows, sturdy arms crossed', bg: '#8a8a80' },
  { id: 'cornerstone', look: 'a careful mason bishop character wearing a hard hat, holding a compass tool, neat mustache', bg: '#3f7d8c' },
  { id: 'tactician', look: 'a sly fox character with a gold monocle, raised eyebrow, chess-patterned waistcoat', bg: '#c9742e' },
  { id: 'strategist', look: 'a wise badger professor character with small round spectacles, a rolled opening-theory map under one arm', bg: '#35597a' },
  { id: 'nyx', look: 'an elegant raven queen character with sleek black feathers, silver crown, calm piercing eyes', bg: '#2f2f38' },
  { id: 'grandmaster', look: 'a stern elder wizard king character with a long silver beard, deep hood, judging look', bg: '#5b4a68' },
  { id: 'titan', look: 'a massive iron golem character with glowing amber core in the chest, cracked stone armor, heavy brow', bg: '#4a4a52' },
  { id: 'maximum', look: 'a sleek chrome robot overlord character, glowing red visor eyes, sharp geometric head, faint circuit lines', bg: '#1f1f22' },
]

const COACHES = [
  { id: 'nina', look: 'friendly woman in her early thirties with a dark ponytail and a green cardigan, encouraging warm smile' },
  { id: 'victor', look: 'energetic man in his late twenties with short curly black hair and an orange track jacket, big excited grin' },
  { id: 'elena', look: 'calm woman with dark hair streaked with silver, teal blazer, thoughtful precise expression, arms folded' },
  { id: 'sasha', look: 'older man with a trimmed gray beard, gold-rimmed glasses, charcoal sweater, dry knowing half-smile' },
]

const BOT_STYLE =
  'cute flat vector mascot avatar, bold clean shapes, thick soft outlines, head and shoulders centered, solid flat background color, no text, no watermark, high quality'
const COACH_STYLE =
  'character portrait illustration, painterly digital art, head and shoulders, soft chess club background with a blurred board, warm cinematic light, no text, no watermark, high quality'

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))])
}

const START = parseInt(process.argv[2] ?? '0', 10)
const END = parseInt(process.argv[3] ?? '999', 10)

async function main() {
  const zai = await ZAI.create()
  fs.mkdirSync('public/bots', { recursive: true })
  fs.mkdirSync('public/coaches', { recursive: true })

  const allBots = BOTS
  for (const b of allBots.slice(START, END)) {
    const out = path.join('public/bots', `${b.id}.png`)
    if (fs.existsSync(out) && fs.statSync(out).size > 10000) { console.log('skip', b.id); continue }
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await withTimeout(zai.images.generations.create({
          prompt: `${b.look}. ${BOT_STYLE}. Background color ${b.bg}.`,
          size: '1024x1024',
        }), 120000)
        const buf = Buffer.from(res.data[0].base64, 'base64')
        await sharp(buf).resize(256, 256).png({ quality: 90 }).toFile(out)
        console.log('ok bot', b.id)
        break
      } catch (e) {
        console.error('fail bot', b.id, 'attempt', attempt, e.message)
        if (attempt === 3) console.error('GIVEUP bot', b.id)
      }
    }
  }

  for (const c of COACHES) {
    const out = path.join('public/coaches', `${c.id}.png`)
    if (fs.existsSync(out) && fs.statSync(out).size > 10000) { console.log('skip', c.id); continue }
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await withTimeout(zai.images.generations.create({
          prompt: `${c.look}. ${COACH_STYLE}.`,
          size: '1024x1024',
        }), 120000)
        const buf = Buffer.from(res.data[0].base64, 'base64')
        await sharp(buf).resize(400, 400).png({ quality: 88 }).toFile(out)
        console.log('ok coach', c.id)
        break
      } catch (e) {
        console.error('fail coach', c.id, 'attempt', attempt, e.message)
        if (attempt === 3) console.error('GIVEUP coach', c.id)
      }
    }
  }
  console.log('DONE')
}

main().catch((e) => { console.error('FATAL', e.message); process.exit(1) })
