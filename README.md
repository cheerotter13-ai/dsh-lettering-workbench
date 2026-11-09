# DSH 嵌字工作台

Windows 优先的本地 DSH 插件。使用原有三栏工作台：左侧图片列表、中间可编辑画布、右侧文字和贴纸。
不依赖模型接口；插件不会上传图片、调用云端模型或扫描下载目录。

> 此版本是待发布源码提取包。项目许可证、署名尚未确定，禁止误发布保护仍开启。
> 其他操作系统未验证。Photoshop 联动是底图修图，不是可编辑文字图层 PSD 导出。

## 安装

需要已安装的 DSH Web、支持 `node:sqlite` 的 Node.js 22.13 或更高版本，以及 Python 3.11 或更高版本。
使用独立 DSH profile 试装，不建议直接在已有生产 profile 中替换旧工作台。

1. 解压或克隆本项目，进入项目根目录。
2. 安装渲染依赖：

   ```powershell
   python -m venv .venv
   .\.venv\Scripts\python.exe -m pip install -r requirements.txt
   ```

3. 从 DSH 自带 Web 模板初始化独立 profile（不启动服务）：

   ```powershell
   dsh --profile lettering --from-default-profile web --dump-config
   ```

4. 安装插件目录，或把最后一个参数替换为收到的 `.tgz` 文件绝对路径：

   ```powershell
   dsh plugin --profile lettering add (Get-Location).Path
   ```

   插件声明了 DSH bundle，安装后应自动登记。确认所选 profile 的 `package.json`
   中 `dsh.profile.bundles` 包含 `dsh-lettering-workbench`。

5. 在该 profile 的 `cordis.patch.yml` 中合并 `config.example.yml`，
   把 `pythonPath` 设置为本项目 `.venv\Scripts\python.exe` 的实际绝对路径。
   不要覆盖原有的其他配置条目。
6. 启动：

   ```powershell
   dsh --profile lettering --host 127.0.0.1
   ```

7. 点击侧栏「嵌字工作台」。第一次启动没有作品；使用「选择图片新建作品」。

默认数据目录是当前用户主目录下 `.dsh-lettering-workbench`，可通过 `dataDir` 修改。
源码和安装包不携带任何作品。请保持本地回环地址监听，不将文件操作接口直接暴露到公网。

## 编辑与导出

- 选择同一文件夹的 PNG/JPEG/WebP 图片，按自然数字顺序导入；原图只读。
- 右侧添加对白、内心、旁白或拟声。点击文字拖动，双击编辑；样式区支持字号、字体、颜色、横竖排、旋转和间距。
- 文字渲染沿用固定白色描边和投影；不是任意 Photoshop 图层样式编辑器。
- 在作品设置中配置角色及配色。Ctrl+Z / Ctrl+Shift+Z 撤销和重做。
- 翻页不会自动定稿。点击「通过并定稿」保存当前语言的 PNG。
- 更多菜单可切换中、英、日、韩手动版本，没有自动翻译。改中文后，旧译文会标记待更新。
- 「按当前语言和顺序导出成品」只导出当前有效定稿，跳过未定稿、已过期及隐藏页面，并列出原因。
- 每次批量导出使用新目录，不覆盖先前导出。工作台会显示完整输出路径。
- 「素材」中导入自己的 PNG 贴纸，支持拖动、缩放、旋转、透明度、翻转及文字上下层次。

数据库、修图副本、定稿、导出、历史与缓存都位于独立数据目录。
备份时关闭该 profile，然后复制完整数据目录；导入的原始图片仍需保留。

## Photoshop 联动

1. 点击本页「PS 修图」。插件将当前底图转换为 PNG 工作副本，再用 Photoshop 打开。
2. Ctrl+S 保存该 PNG；如需要 PSD，在相同目录另存为同名 `background.psd`，启用兼容合成图。
3. 文件写入稳定且解码成功后，工作台更新底图；当前文字保持独立可编辑。
4. 同尺寸保留位置；尺寸改变会提示检查和重新排版，不擅自移动手工文字。
5. 修改底图使旧定稿过期，需要重新定稿。可从底图历史回退。
6. 完成后点「停止监听」。退出 DSH 会停止监听，不会关闭用户的 Photoshop 或其他文档。

默认通过 Windows 注册表寻找 Photoshop；也可配置 `photoshopPath`。
损坏、写入中或无可用兼容图的 PSD 不会替换当前有效底图，错误显示在 PS 面板中。

## 字体

默认只随包提供带 OFL 文件的霞鹜文楷。不同语言的字形覆盖不作全覆盖保证，缺字会在界面提示。
可复制 `assets/fonts/manifest.json` 到自己的配置目录，通过 `fontManifest` 指定它，
在 `fonts` 中登记已获许可的本机字体文件，在 `styles` 中登记可选字体名，
并在 `fallbacks` 中按语言添加回退字体键。相对路径相对于该 manifest 所在目录。
修改配置后重启 profile；不需要把字体安装到系统中。

## 可选本地人物检测

不安装检测依赖也可以嵌字、基础排版和手动画保护区域。

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-detection.txt
```

用户自行准备来源和使用条件明确的 `yolox_l.onnx` 与 `dw-ll_ucoco_384.onnx`，
放在同一目录，通过 `modelDir` 配置，再设置 `detectionEnabled: true`。
插件不自动下载模型，也不包含模型权重。模型未就绪或检测失败会明确显示状态；
这不会变成“已经避开所有人物”的保证，最终位置仍需人工查看。

## 开发验证

```powershell
npm test
npm run check:privacy
npm pack
```

测试使用程序生成的中性图片。可设置 `TEST_TMPDIR` 指定测试产物目录，
设置 `TEST_PYTHON` 指定 Python 解释器。测试不会连接生产 DSH。
`private: true` 不妨碍本地打包；不应在许可证确认前移除发布保护。

## 当前验证边界

- Windows、DSH 0.2.0-rc.2、Node.js 22.15.0、Python 3.13 已试装。
- 仅安装核心 Python 依赖的干净虚拟环境中，14 项自动化测试通过。
- 真实 DSH 页面已验证中性图片嵌字与定稿；安装包另在空 profile 验证导入、定稿和导出。
- PS 的 PNG/兼容 PSD、连续保存、坏文件、尺寸变化、停止监听及回退通过文件级自动化测试。
  真实 Photoshop 能打开工作副本，但测试机器的应用授权提示阻断了编辑，实际 Ctrl+S 回传仍待复验。
- 人物检测未使用真实权重做推理验收；已测试未启用、缺少依赖和缺少模型时的降级。
- 原生选图窗口已通过 PowerShell 解析验证，完整人工选图流程待复验；其他操作系统未验证。
