# TuneHub · 音枢 | 氛围电子音乐工作室

TuneHub 是开源、浏览器优先的音乐生成实验室，当前包含场景化氛围电子音乐、确定性生成、无尽播放，以及 WAV、分轨、MIDI 和 Score 导出。

## 运行

```bash
python3 serve.py
```

然后打开 <http://127.0.0.1:8765/>。项目使用 ES Module，必须通过本地服务器访问。

## 功能

- 选择聆听场景并生成场景化氛围电子音乐。
- 调整情绪、能量和速度，锁定声部后重掷其他声部。
- 通过分享链接复现作品；启用无尽模式可连续生成后续片段。
- 导出 WAV、分轨、Standard MIDI File 或保留微分音信息的 TuneHub Score。

## 验证

```bash
node --test 'tests/*.test.mjs'
node tests/run-browser-check.mjs http://127.0.0.1:8765
```

## 文档

- [产品概览](OVERVIEW.md)
- [架构设计](ARCHITECTURE.md)
- [路线图](ROADMAP.md)
- [氛围音乐架构](AMBIENT_ARCHITECTURE.md)
- [内容包说明](CONTENT_PACKS.md)
- [场景声学设计调研](AMBIENT_SCENE_SOUND_DESIGN_RESEARCH.md)
- [内容包样例与贡献指南](examples-README.md)
- [历史调研文档](archive/)
