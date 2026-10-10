# 猜猜看 — 微信多人匿名投票猜測遊戲

3–12 個朋友透過微信進入同一個房間：輪流出是非題、所有人匿名投「是／否」、
再猜每個人投了什麼。**只有全部猜對才會被告知**，而且誰投了什麼永遠不會被揭露。

- 前端：Taro 4 + React 18 + TypeScript strict
- 後端：微信雲開發（單一雲函數 `game`）+ 雲資料庫
- 即時同步：雲資料庫 `watch`
- 測試：Vitest，46 個案例（含併發、重複提交、斷線重連、非法操作）

## 快速開始

```bash
npm run setup          # 安裝前後端依賴並建置雲函數
npm run cloud:test     # 46 passed
npm run build:weapp    # 產生 dist/
```

接著照 [docs/DEPLOY.md](docs/DEPLOY.md) 完成微信平台的設定。

## ⚠️ 需要你手動完成的事（程式碼無法代勞）

| # | 事項 | 填到哪裡 |
| --- | --- | --- |
| 1 | 註冊小程序、取得 **AppID** | `project.config.json` → `"appid"` |
| 2 | 開通雲開發、建立環境、取得 **環境 ID** | `src/config.ts` → `CLOUD_ENV` |
| 3 | 建立 5 個資料庫集合並設定權限（`docs/db-rules/`） | 雲開發控制台 |
| 4 | 右鍵部署雲函數 `cloudfunctions/game`、設定環境變數 `PID_SALT` | 開發者工具 / 控制台 |
| 5 | 上傳體驗版、加入體驗成員、提交審核 | 小程序後台 |

每一步的詳細操作都在 [docs/DEPLOY.md](docs/DEPLOY.md)。

## 文件

| 文件 | 內容 |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 目錄結構、資料庫 Schema、狀態機、API、即時同步、併發策略、已知限制 |
| [docs/DEPLOY.md](docs/DEPLOY.md) | 從註冊到發布的完整步驟、疑難排解 |
| [docs/TESTING.md](docs/TESTING.md) | 自動化測試覆蓋範圍、手動多人測試腳本 |

## 專案結構（摘要）

```
src/                    Taro 小程序
  pages/index           建立 / 加入房間
  pages/lobby           大廳：房間碼、分享、準備、開始
  pages/game            遊戲：出題 → 投票 → 猜測 → 結算（四個子畫面）
  hooks/useRoom.ts      watch 公開資料 + syncState 取私有資料
  services/             callGame、realtime watch（自動重連）
cloudfunctions/game/    雲函數（TypeScript，建置到 dist/）
  src/handlers.ts       所有遊戲邏輯與安全驗證
  test/                 Vitest 測試 + 記憶體假資料庫
docs/                   架構、部署、測試、資料庫規則
```

## 安全設計重點

- 身份只來自雲函數的 `OPENID`；前端送來的任何 ID 都只用來定位，不用來證明身份。
- 公開文件只出現 `pid`（roomId + openid 的單向雜湊），沒有人拿得到別人的 openid。
- `votes` / `guesses` 集合對前端完全不可讀；猜測比對在雲函數內進行，只回傳 `allCorrect` 布林值。
- 投票與猜測文件以 `${roundId}_${pid}` 為 `_id`，資料庫層原子性地阻擋重複提交；重複提交猜測一律回傳第一次的結果，無法暴力嘗試。
- 所有階段轉換都是條件式更新，多人同時觸發只會生效一次。

## 驗證狀態（請務必閱讀）

本專案在 **沒有微信開發者工具與真機的環境** 下開發，實際完成與未完成的驗證如下：

| 項目 | 狀態 |
| --- | --- |
| 雲函數邏輯：46 個自動化測試（含併發）重複執行 5 次全數通過 | ✅ 已驗證 |
| 雲函數 TypeScript strict 編譯、`dist/` 建置 | ✅ 已驗證 |
| 前端 TypeScript strict 型別檢查 | ✅ 已驗證 |
| `taro build --type weapp` 編譯成功並產生完整 `dist/` | ✅ 已驗證 |
| 在微信開發者工具中執行、雲函數實際部署、資料庫 watch 即時同步 | ❌ 未驗證 |
| 真機多人遊玩、微信分享、暱稱快填、背景重連 | ❌ 未驗證 |
| 雲資料庫對 `_.nin`（陣列欄位）、`where({_id}).update()` 的行為與測試用假資料庫一致 | ❌ 依官方文件實作，未實測 |

第一次在開發者工具跑起來時，最可能需要調整的是 `project.config.json` 的設定細節與資料庫權限，
而不是遊戲邏輯；若遇到問題請先對照 `docs/DEPLOY.md` 的疑難排解表。

## 刻意不做的事

排行榜、聊天、商城、付費、頭像上傳、歷史回顧。這些都不在 MVP 範圍，`rounds` 集合已保留回合紀錄，日後要加回顧功能可直接使用。
