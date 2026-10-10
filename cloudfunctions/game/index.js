// 雲函數入口檔。實際邏輯以 TypeScript 寫在 src/，部署前請先執行 `npm run build` 產生 dist/。
exports.main = require('./dist/main').main
