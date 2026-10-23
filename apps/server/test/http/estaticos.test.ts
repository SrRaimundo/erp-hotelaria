import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { criarApp } from "../../src/http/app.js";
import { criarContextoTeste, entrarComo } from "../ajuda.js";

const temporarios: string[] = [];
afterEach(() => {
  for (const d of temporarios.splice(0)) rmSync(d, { recursive: true, force: true });
});

function webDirTemporario(): string {
  const dir = mkdtempSync(join(tmpdir(), "erp-web-"));
  temporarios.push(dir);
  writeFileSync(join(dir, "index.html"), "<h1>ERP</h1>");
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "assets", "app.js"), "console.log('ok');");
  return dir;
}

describe("arquivos estáticos da interface", () => {
  test("serve index.html em rotas da interface e mantém a API sob autenticação", async () => {
    const ctx = await criarContextoTeste();
    const app = criarApp(ctx, { webDir: webDirTemporario() });
    const raiz = await app.inject("/");
    expect(raiz.statusCode).toBe(200);
    expect(raiz.body).toContain("ERP");
    const mapa = await app.inject("/mapa");
    expect(mapa.statusCode).toBe(200);
    expect(mapa.headers["content-type"]).toMatch(/text\/html/);
    expect(mapa.body).toContain("ERP");
    expect((await app.inject("/reservas/abc?aba=conta")).body).toContain("ERP");
    expect((await app.inject("/assets/app.js")).statusCode).toBe(200);

    const api = await app.inject("/api/inexistente");
    expect(api.statusCode).toBe(401);
    expect(api.body).not.toContain("ERP");
    expect((await app.inject("/api/quartos")).statusCode).toBe(401);
    expect((await app.inject("/%61pi/quartos")).statusCode).toBe(401);
    expect((await app.inject("/API/quartos")).body).not.toContain("<h1>");

    const admin = await entrarComo(ctx, "admin");
    const autenticada = await app.inject({ url: "/api/inexistente", headers: admin });
    expect(autenticada.statusCode).toBe(404);
    expect(autenticada.headers["content-type"]).toMatch(/application\/json/);
    expect(autenticada.body).not.toContain("ERP");
  });

  test("sem build da interface, servidor segue só com a API", async () => {
    const ctx = await criarContextoTeste();
    const inexistente = join(tmpdir(), "erp-web-que-nao-existe");
    const app = criarApp(ctx, { webDir: inexistente });
    expect((await app.inject("/")).statusCode).toBe(404);
    expect((await app.inject("/mapa")).statusCode).toBe(404);
    expect((await app.inject("/api/quartos")).statusCode).toBe(401);
    const admin = await entrarComo(ctx, "admin");
    expect((await app.inject({ url: "/api/quartos", headers: admin })).statusCode).toBe(200);
  });
});
