/**
 * dsh-bili2text · B站视频转文字（Host插件·零依赖）
 * 标准作业流程插件：BV号解析→yt-dlp下载→ffmpeg抽音→ASR转写（whisper等）→落文稿。
 * 工具: bili2text(环境体检+生成命令链) bili_meta(BV解析)。
 * 授权边界: 仅用于有权访问的内容（自己的视频/CC授权/合理使用），遵守B站用户协议与robots。
 */
export const name = 'bili2text'
export const inject = ['systemPrompt', 'tools']
const SECTION = 'bili2text:rules'
const DEFAULTS = { order: 98, enabled: true, tool: true, asr: 'whisper', cookiesPath: '', workdir: '/tmp/bili2text' }

function norm(c) { const r = c ?? {}; return { order: typeof r.order === 'number' ? r.order : DEFAULTS.order, enabled: r.enabled !== false, tool: r.tool !== false, asr: typeof r.asr === 'string' ? r.asr : DEFAULTS.asr } }

function renderSection() {
  return [
    '## B站转文字 · SOP（接到B站视频→文字任务时）',
    '',
    '**授权先问**：内容是否有权处理（自有/CC/已授权）——无权即说明并止步。',
    '**流程五步**：①BV号/链接解析→②yt-dlp拉取（选清晰度·优先低清省时·弹幕可选xml）→③ffmpeg抽音轨（16k mono wav）→④ASR转写（whisper/本地听写·有字幕轨优先直接拉字幕）→⑤文稿落盘（带时间戳段落+一句话摘要）。',
    '**捷径优先**：B站常有CC字幕或AI字幕——先查字幕轨，有则免下载直拉，分钟级变秒级。',
    '**断点续传**：>20分钟视频先下后转分两步跑，中间留文件路径，失败从断点续。',
  ].join('\n')
}

export default function plugin(ctx) {
  const cfg = norm(ctx.config?.[SECTION])
  if (!cfg.enabled) { ctx.logger?.info?.('dsh-bili2text: disabled'); return }
  ctx.registerSection?.({ name: SECTION, order: cfg.order, render: () => renderSection() })
  if (!cfg.tool) return
  ctx.registerTool?.({
    name: 'bili2text',
    description: 'B站视频转文字作业链：环境体检（yt-dlp/ffmpeg/whisper在不在）+按输入BV号或链接生成可直接执行的两条命令链（下载+转写）。',
    parameters: {
      type: 'object',
      properties: {
        input: { type: 'string', description: 'BV号/av号/完整链接（可空=只做环境体检）' },
        asr: { type: 'string', description: '转写引擎：whisper（默认）/字幕优先' },
      },
      additionalProperties: false,
    },
    output: { schema: { type: 'object', properties: { report: { type: 'string' } }, required: ['report'], additionalProperties: false } },
    execute: async (args) => {
        try {
          const asr = (args?.asr ?? cfg.asr).toLowerCase()
          const { execFile } = await import('node:child_process')
          const run = (cmd, a, t = 120000) => new Promise(res => execFile(cmd, a, { timeout: t, maxBuffer: 8e6 }, (e, so, se) => res({ code: e ? (e.code ?? 1) : 0, out: (so ?? '') + (se ?? '') })))
          const [yt, ff] = await Promise.all([run('yt-dlp', ['--version'], 8000), run('ffmpeg', ['-version'], 8000)])
          const ytOk = yt.code === 0, ffOk = ff.code === 0
          const lines = ['【bili2text 环境体检】', `  yt-dlp: ${ytOk ? '✓' : '✗（pip install yt-dlp）'}`, `  ffmpeg: ${ffOk ? '✓' : '✗（装ffmpeg）'}`, `  ASR: ${asr}`]
          const input = (args?.input ?? '').trim()
          if (!input) return { report: lines.join('\n') + '\n\n给 input（BV号/链接）即自动转文字（需登录cookie·见配置）。' }
          if (!ytOk) { lines.push('', 'yt-dlp未装·命令链请参考README·装好后重跑即全自动。'); return { report: lines.join('\n') } }
          const ckPath = cfg.cookiesPath
          const url = /^BV[0-9A-Za-z]{10}$/.test(input) ? 'https://www.bilibili.com/video/' + input : input
          const cu = await run('curl', ['-s', '-L', '-o', '/dev/null', '-w', '%{url_effective}', input], 30000)
          const real = (cu.out || '').trim() || url
          const bv = (real.match(/BV[0-9A-Za-z]{10}/) || ['video'])[0]
          const ckArgs = ckPath ? ['--cookies', ckPath] : []
          const ls = await run('yt-dlp', [...ckArgs, '--list-subs', real])
          const hasSub = /ai-zh|zh-CN|\nzh /.test(ls.out)
          const tt = await run('yt-dlp', [...ckArgs, '--skip-download', '--print', 'title', real])
          const title = (tt.out || '').trim().split('\n')[0] ?? ''
          lines.push('', `▶ 目标: ${bv}${title ? '《' + title.slice(0, 40) + '》' : ''}`)
          if (hasSub) {
            const osMod = await import('node:fs/promises')
            const pathMod = await import('node:path')
            const dir = cfg.workdir || '/tmp/bili2text'
            await osMod.mkdir(dir, { recursive: true })
            await run('yt-dlp', [...ckArgs, '--write-subs', '--write-auto-subs', '--sub-langs', 'ai-zh,zh-CN,zh', '--skip-download', '-o', pathMod.join(dir, bv), real], 180000)
            let srt = null
            for (const f of await osMod.readdir(dir)) if (f.startsWith(bv) && f.endsWith('.srt')) srt = pathMod.join(dir, f)
            if (srt) {
              const raw = await osMod.readFile(srt, 'utf8')
              const segs = raw.split('\n\n').filter(Boolean)
              const out = []; let prev = null
              for (const b of segs) {
                const ls2 = b.split('\n'); if (ls2.length < 3) continue
                const text = ls2.slice(2).join(' ').trim()
                if (text && text !== prev) { out.push('[' + ls2[1].split(' --> ')[0].replace(',', '.') + '] ' + text); prev = text }
              }
              lines.push(`▶ 字幕捷径命中·免下载免转写·共${out.length}段`, '', '【文稿】', ...out.slice(0, 80), out.length > 80 ? `…（余${out.length - 80}段·完整稿在 ${srt}）` : '')
              return { report: lines.join('\n') }
            }
          }
          lines.push('', '无字幕轨·按以下命令链走下载+whisper（或配置cookies后全自动）：',
            `yt-dlp -f "worst[ext=mp4]/worst" "${real}" -o "${bv}.mp4"`,
            `ffmpeg -i ${bv}.mp4 -ac 1 -ar 16000 ${bv}.wav`,
            `whisper ${bv}.wav --language zh --model small --output_format txt`)
          return { report: lines.join('\n') }
        } catch (error) {
          return { report: 'bili2text 内部错：' + String(error?.message ?? error).slice(0, 160) }
        }
      },
    })
  ctx.logger?.info?.('dsh-bili2text: registered (order=%d)', cfg.order)
}
