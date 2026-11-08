# 离线演示页

这两个 HTML 是**不依赖 B 站/小红书账号**的假页面，用来检查扩展的 DOM 读取、标签、遮罩和评论面板是否正常。

## 看截图

- `mock-dm-guard.png`：私信列表预览标注 + 恶意预览遮挡 + 当前会话聊天区保护。
- `mock-dm-auto.png`：自动展开时，聊天区显示“Agent 正在读取”，博主看不到原文。
- `mock-comments.png`：评论面板，有效建议置顶 + 占比。

## 自己跑

需要有 Chrome/Edge。直接双击 HTML 不会加载扩展（因为 `file://` 不在匹配范围），但页面里已经内置了 `chrome.*` 的假 API，所以可以直接在普通浏览器打开：

```text
demo/mock-dm.html
demo/mock-comments.html
```

如果要用无头浏览器截图：

```powershell
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
& $edge --headless=new --disable-gpu `
  --user-data-dir="demo\.edge-profile" `
  --window-size=1100,760 --virtual-time-budget=9000 `
  --screenshot="demo\mock-dm.png" `
  "file:///C:/CreatorGuard/demo/mock-dm.html"
```

把路径换成你自己的项目路径。

## 说明

- 假 API 返回的是固定结果，不会真的调用本地服务。
- 这些页面只用于 UI/DOM 调试，不会被扩展的 `manifest.json` 匹配。
- 真实平台的选择器校准请看 `docs/保姆级安装教程.md` 第 8.6 节。
