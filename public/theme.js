// React が起動する前にテーマを当てる（CSP で inline script を禁じているので外部ファイルにしている）
try {
  document.documentElement.dataset.theme = localStorage.getItem("kaimono:theme") === "dark" ? "dark" : "light";
} catch (e) {
  document.documentElement.dataset.theme = "light";
}
