require("dotenv").config();
const app = require("./app");

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log("\n🌙 Calenio API rodando na porta " + PORT);
  console.log("📦 Ambiente: " + (process.env.NODE_ENV || "development"));
  console.log("🌐 Frontend: " + (process.env.FRONTEND_URL || "http://localhost:3000") + "\n");
});