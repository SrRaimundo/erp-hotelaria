import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = resolve(aqui, "../../..");
const servidor = join(raiz, "apps/server");
const dist = join(raiz, "apps/web/dist");
const PORTA = 8099;
/** Segunda instância, com banco vazio (só migrações): serve ao roteiro de implantação. */
const PORTA_VAZIA = 8098;

function executar(comando: string, args: string[], opcoes: { cwd: string; env?: NodeJS.ProcessEnv; shell?: boolean }): Promise<void> {
  return new Promise((ok, falha) => {
    const filho = spawn(comando, args, { ...opcoes, env: { ...process.env, ...opcoes.env }, stdio: "inherit" });
    filho.on("error", falha);
    filho.on("exit", (codigo) => (codigo === 0 ? ok() : falha(new Error(`${comando} ${args.join(" ")} terminou com código ${codigo}`))));
  });
}

async function esperarServidor(filho: ChildProcess, porta: number): Promise<void> {
  const limite = Date.now() + 30_000;
  while (Date.now() < limite) {
    if (filho.exitCode !== null) throw new Error("O servidor encerrou antes de ficar pronto.");
    try {
      const r = await fetch(`http://localhost:${porta}/`);
      if (r.ok) return;
    } catch {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("O servidor não respondeu em 30 s.");
}

async function encerrar(filho: ChildProcess): Promise<void> {
  if (filho.exitCode === null) {
    const saiu = new Promise((r) => filho.once("exit", r));
    filho.kill();
    await saiu;
  }
}

/** Sobe um servidor com banco novo numa pasta temporária; com `semear`, antes carrega a pousada de demonstração. */
async function subir(porta: number, semear: boolean): Promise<() => Promise<void>> {
  const pasta = mkdtempSync(join(tmpdir(), `erp-e2e-${porta}-`));
  const env = { ERP_DB: join(pasta, "e2e.db"), ERP_PORTA: String(porta), ERP_HOST: "127.0.0.1", ERP_WEB_DIR: dist };
  const tsx = ["--import", "tsx"];
  const limpar = () => {
    if (existsSync(pasta)) rmSync(pasta, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };
  try {
    if (semear) await executar(process.execPath, [...tsx, "src/demo.ts"], { cwd: servidor, env });
    // Sem semear, o main.ts cria o banco e aplica as migrações (inclui o admin inicial).
    const filho = spawn(process.execPath, [...tsx, "src/main.ts"], { cwd: servidor, env: { ...process.env, ...env }, stdio: "inherit" });
    try {
      await esperarServidor(filho, porta);
    } catch (erro) {
      filho.kill();
      throw erro;
    }
    return async () => {
      await encerrar(filho);
      limpar();
    };
  } catch (erro) {
    limpar();
    throw erro;
  }
}

/** globalSetup: build da web e dois servidores: 8099 com a pousada de demonstração e 8098 com banco vazio. */
export default async function preparar(): Promise<() => Promise<void>> {
  await executar("npm", ["run", "build", "-w", "apps/web"], { cwd: raiz, shell: true });

  const paraDemo = await subir(PORTA, true);
  let paraVazio: () => Promise<void>;
  try {
    paraVazio = await subir(PORTA_VAZIA, false);
  } catch (erro) {
    await paraDemo();
    throw erro;
  }
  return async () => {
    await paraVazio();
    await paraDemo();
  };
}
