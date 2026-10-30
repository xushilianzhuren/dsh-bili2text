# dsh-bili2text · B站视频转文字

Bilibili video → text SOP as a plugin: **subtitle-first shortcut + ready-to-run command chains + environment check**.

## 流程
①BV号解析→②**先查CC/AI字幕**（有则免下载·秒出）→③无字幕才 yt-dlp 低清拉取→④ffmpeg抽16k mono音轨→⑤whisper转写→⑥文稿落盘（时间戳段落+一句话摘要）。>20分钟视频分两步跑·断点续传。

## 工具 `bili2text`
- `input` 给BV号/链接 → 生成可直接执行的两条命令链（拉取+转写）
- 留空 → 环境体检（yt-dlp/ffmpeg/whisper 在不在·缺什么装什么）

## 授权
仅用于有权访问的内容（自有视频/CC授权/合理使用），遵守B站用户协议。

## 安装
```
dsh plugin add github:xushilianzhuren/dsh-bili2text
```
MIT License.
