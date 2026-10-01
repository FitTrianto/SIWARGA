/**
 * Titik masuk server (task B16). Jalankan dengan `pnpm dev` (tsx watch)
 * atau `pnpm build && pnpm start` untuk produksi.
 */
import { buatAplikasi } from "./app.js";
import { config } from "./config.js";
import { databaseTersedia, tutupDb } from "./services/db.js";

const app = await buatAplikasi();

try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(
    {
      env: config.env,
      alamat: `http://${config.host === "0.0.0.0" ? "localhost" : config.host}:${config.port}`,
      database: databaseTersedia() ? "dikonfigurasi" : "belum_dikonfigurasi (jalankan prisma:migrate + db:seed)",
    },
    "SIWARGA server berjalan",
  );
} catch (err) {
  app.log.error(err, "gagal memulai server");
  process.exit(1);
}

let sedangMematikan = false;

async function matikan(sinyal: string): Promise<void> {
  if (sedangMematikan) return;
  sedangMematikan = true;
  app.log.info({ sinyal }, "mematikan server…");
  try {
    await app.close();
    await tutupDb();
    process.exit(0);
  } catch (err) {
    app.log.error(err, "galat saat mematikan server");
    process.exit(1);
  }
}

process.on("SIGINT", () => void matikan("SIGINT"));
process.on("SIGTERM", () => void matikan("SIGTERM"));
