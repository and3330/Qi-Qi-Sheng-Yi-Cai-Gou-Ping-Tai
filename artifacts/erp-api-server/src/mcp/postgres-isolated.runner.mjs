// Only disposable private Unix-socket PostgreSQL; never reads shared DB credentials.
import { mkdtemp, mkdir, appendFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
const root = await mkdtemp(path.join(os.tmpdir(),"mcp-pg-"));
const data = path.join(root,"data"), socket = path.join(root,"socket");
const api = path.resolve(import.meta.dirname,"../..");
const db = path.resolve(api,"../../lib/db");
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "DATABASE_URL" && !k.startsWith("PG")));
function run(command,args,cwd,extra={}) {
  return new Promise((resolve,reject) => {
    const child = spawn(command,args,{cwd,env:{...env,...extra},stdio:"inherit"});
    child.once("error",reject);
    child.once("exit",code => code === 0 ? resolve() : reject(new Error(`${command} exit ${code}`)));
  });
}
let started = false;
try {
  await mkdir(socket);
  await run("initdb",["-D",data,"-U","mcp_owner","--auth-local=trust","--auth-host=reject","--no-instructions"]);
  await appendFile(path.join(data,"postgresql.conf"),`\nlisten_addresses=''\nunix_socket_directories='${socket}'\nport=55439\n`);
  await run("pg_ctl",["-D",data,"-l",path.join(root,"pg.log"),"-w","start"]); started=true;
  await run("createdb",["-h",socket,"-p","55439","-U","mcp_owner","mcp_acceptance"]);
  const url = `postgresql://mcp_owner@localhost/mcp_acceptance?host=${encodeURIComponent(socket)}&port=55439`;
  await run("pnpm",["exec","drizzle-kit","push","--force","--dialect","postgresql","--schema","./src/schema/index.ts","--url",url],db);
  const testFile = process.argv.includes("--approvals")
    ? "src/routes/__tests__/ai-drafts.postgres.test.ts"
    : "src/mcp/mcp.postgres.test.ts";
  await run("pnpm",["exec","vitest","run",testFile],api,{MCP_TEST_PG_ROOT:root,MCP_TEST_PG_SOCKET:socket,NODE_ENV:"test"});
} finally {
  if (started) await run("pg_ctl",["-D",data,"-m","immediate","-w","stop"]).catch(()=>{});
  await rm(root,{recursive:true,force:true});
}
