# Business Price Radar

一个独立的 ChatGPT Business 全球月付地区价格查询工具。项目从 `chatgpt.com` 的公开结账价格配置中读取 `currency_config.business.month`，保留官方原币价格，并按公开汇率换算为人民币或美元。

> 本项目不是 OpenAI 官方产品，与 OpenAI 没有隶属、合作或背书关系。实际价格、税费、付款资格和地区可用性以结账页为准。

## 功能

- 探测完整的 ISO 3166-1 alpha-2 国家和地区代码。
- 仅展示标准 ChatGPT Business 月付价格，不包含年付或非营利套餐。
- 显示官方原币价格、人民币/美元估算、含税或未含税口径。
- 支持搜索、筛选、排序以及桌面表格和移动端卡片。
- GitHub Actions 每两天刷新，结构异常或覆盖率骤降时停止部署。
- 单个地区暂时失败时，最多沿用 14 天的上次成功结果并标记为“数据暂旧”。

## 本地开发

需要 Node.js 22 或更高版本，推荐 Node.js 24 LTS。

```bash
npm install
npm run dev
```

本地首次打开会使用 `public/data/sample-prices.json` 演示数据。获取真实数据：

```bash
npm run collect
npm run dev
```

生成的 `public/data/prices.json` 已加入 `.gitignore`，不会提交到仓库。

常用检查：

```bash
npm test
npm run typecheck
npm run build
```

## 数据采集规则

采集器位于 `scripts/collect-prices.mjs`：

1. 遍历 249 个 ISO 国家/地区代码。
2. 请求 `https://chatgpt.com/backend-anon/checkout_pricing_config/configs/{CODE}`。
3. 校验返回地区、币种和 `business.month.amount/tax`。
4. 以 Frankfurter 为主要汇率源；未覆盖币种由 `open.er-api.com` 补齐。
5. 通过美元中间价换算：`USD = 本币金额 ÷ USD→本币汇率`，`CNY = USD × USD→CNY汇率`。
6. 不自行加税，只展示接口提供的税务口径。

采集请求不使用 Cookie、设备 ID、会话 ID、登录凭据或浏览器指纹头。

### 发布保护

- 首次快照必须包含新鲜的 US、至少一个非 USD 地区、CNY 汇率和至少 20 个有效地区。
- 后续快照总行数不得低于上一线上快照的 90%。
- 任何保护条件失败时，Action 直接失败，不会覆盖当前线上版本。

可通过环境变量调整：

- `PREVIOUS_SNAPSHOT_URL`：上一线上快照地址。
- `PREVIOUS_SNAPSHOT_PATH`：本地上一快照路径。
- `MIN_FIRST_RUN_ROWS`：首次部署最少行数，默认 `20`。
- `OUTPUT_PATH`：输出文件，默认 `public/data/prices.json`。

## GitHub Pages 发布

1. 新建 GitHub 仓库并推送本目录内容，默认分支命名为 `main`。
2. 打开仓库 **Settings → Pages**。
3. 在 **Build and deployment → Source** 中选择 **GitHub Actions**。
4. 打开 **Actions → Refresh prices and deploy Pages → Run workflow**，执行首次手动刷新。
5. 首次成功后，网站会发布到仓库对应的 GitHub Pages 地址。

工作流还会在北京时间每天 03:17 唤醒，通过日期门控每两天真正刷新一次；主分支推送和手动运行会立即刷新。

GitHub 可能在公开仓库连续 60 天没有活动后停用定时工作流。本项目按约定不创建保活提交；如被停用，请在 Actions 页面手动重新启用并运行一次。

## 计费与免责声明

ChatGPT Business 按标准席位计费，通常至少需要两个标准席位。本站表格显示的是接口返回的**每用户月价**，不代表两席位总账单。企业税号、VAT/GST、反向征税、发卡行汇率和手续费都可能改变最终金额。

- [OpenAI Business 官方价格页](https://openai.com/business/pricing/)
- [OpenAI Business 账单与席位说明](https://help.openai.com/en/articles/8792536)

## 授权与归属

代码采用 [MIT License](LICENSE)。

ChatGPT 与 OpenAI 是其各自权利人的商标。本项目仅作描述性使用。项目受到 PriceAI 信息架构的启发，但没有复制 PriceAI 的代码、品牌、素材、价格快照或线上数据；详见 [NOTICE.md](NOTICE.md)。
