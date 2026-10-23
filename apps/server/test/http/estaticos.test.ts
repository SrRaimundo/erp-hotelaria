import net from "node:net";
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

describe("segurança das rotas estáticas", () => {
  const caminhosDaApi = ["/api/quartos", "/API/quartos", "/api%2Fquartos", "/%61pi/quartos", "/api", "/api/", "//api/quartos"];

  test.each(caminhosDaApi.flatMap((c) => ["GET", "HEAD", "OPTIONS"].map((m) => [m, c] as const)))(
    "%s %s nunca devolve dados da API nem index.html sem token",
    async (metodo, caminho) => {
      const ctx = await criarContextoTeste();
      const app = criarApp(ctx, { webDir: webDirTemporario() });
      const r = await app.inject({ method: metodo, url: caminho });
      expect(r.statusCode).not.toBe(200);
      expect([401, 404]).toContain(r.statusCode);
      expect(r.body).not.toContain("<h1>");
      if (!caminho.startsWith("//") && !caminho.startsWith("/API") && caminho !== "/api%2Fquartos") expect(r.statusCode).toBe(401);
    },
  );

  test("requisição em forma absoluta (GET http://h/api/quartos) exige token", async () => {
    const ctx = await criarContextoTeste();
    await entrarComo(ctx, "admin");
    const app = criarApp(ctx, { webDir: webDirTemporario() });
    await app.listen({ port: 0, host: "127.0.0.1" });
    try {
      const porta = (app.server.address() as { port: number }).port;
      const resposta = await new Promise<string>((resolve, reject) => {
        const s = net.connect(porta, "127.0.0.1", () => s.write("GET http://h/api/quartos HTTP/1.1\r\nHost: h\r\nConnection: close\r\n\r\n"));
        let dados = "";
        s.on("data", (d) => (dados += d));
        s.on("end", () => resolve(dados));
        s.on("error", reject);
      });
      expect(resposta.split("\r\n")[0]).toContain("401");
      expect(resposta).not.toContain("Standard");
    } finally {
      await app.close();
    }
  });

  test("travessia de diretório nunca serve arquivo fora do webDir", async () => {
    const ctx = await criarContextoTeste();
    const dir = webDirTemporario();
    writeFileSync(join(dir, "..", "segredo-erp.txt"), "SEGREDO");
    try {
      const app = criarApp(ctx, { webDir: dir });
      for (const c of ["/../segredo-erp.txt", "/%2e%2e/segredo-erp.txt", "/assets/../../segredo-erp.txt", "/assets/%2e%2e/%2e%2e/segredo-erp.txt"]) {
        const r = await app.inject(c);
        expect(r.body, c).not.toContain("SEGREDO");
      }
    } finally {
      rmSync(join(dir, "..", "segredo-erp.txt"), { force: true });
    }
  });
});
