// Segundo login do MCP: o "Buriti operador" (papel automacao, cadastrado como 'vigia'; mig. 054/055).
//
// O login principal (papel agente) lê o sistema e só PROPÕE: a barreira da 051 impede qualquer escrita dele.
// Para administrar tarefas (criar a que o Victor pediu, marcar os próprios passos, confirmar o da pessoa com
// prova, cobrar), o Buriti usa este login, que não lê dado financeiro nem bolsista e só chama as RPCs
// buriti_* da 055. Credencial: CF_OPERADOR_EMAIL/CF_OPERADOR_PASSWORD no ambiente ou o arquivo
// %USERPROFILE%\.buriti\operador.json ({"email","senha"}), gravado por ferramentas/configurar-operador.ps1.
// Nada aqui imprime a senha; log só em stderr.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

export function caminhoCredencial(env = process.env) {
  return path.join(env.USERPROFILE || os.homedir(), '.buriti', 'operador.json');
}

/** Credencial do operador: ambiente primeiro; depois o arquivo. Puro o bastante para testar. */
export function lerCredencial(env = process.env, ler = (p) => fs.readFileSync(p, 'utf8')) {
  if (env.CF_OPERADOR_EMAIL && env.CF_OPERADOR_PASSWORD) {
    return { email: env.CF_OPERADOR_EMAIL, senha: env.CF_OPERADOR_PASSWORD };
  }
  let bruto;
  try {
    bruto = ler(caminhoCredencial(env));
  } catch {
    throw new Error('Login do Buriti operador não configurado: rode ferramentas/configurar-operador.ps1 (o Victor digita a senha).');
  }
  let c;
  try {
    c = JSON.parse(bruto.replace(/^﻿/, ''));
  } catch {
    throw new Error('Arquivo do operador inválido: rode ferramentas/configurar-operador.ps1 de novo.');
  }
  if (typeof c?.email !== 'string' || typeof c?.senha !== 'string' || !c.email || !c.senha) {
    throw new Error('Arquivo do operador sem email/senha: rode ferramentas/configurar-operador.ps1 de novo.');
  }
  return { email: c.email, senha: c.senha };
}

let cliente = null;
let login = null;

async function entrar() {
  const url = process.env.CF_SUPABASE_URL;
  const anonKey = process.env.CF_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error('CF_SUPABASE_URL/CF_SUPABASE_ANON_KEY faltando no ambiente do MCP.');
  const { email, senha } = lerCredencial();
  const sb = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false },
  });
  const { error } = await sb.auth.signInWithPassword({ email, password: senha });
  if (error) throw new Error(`Não foi possível entrar como Buriti operador: ${error.message}.`);
  cliente = sb;
  console.error('[cf-mcp] operador logado');
  return cliente;
}

async function conectado() {
  if (cliente) return cliente;
  if (!login) login = entrar().finally(() => { login = null; });
  return login;
}

function sessaoMorta(error) {
  if (!error) return false;
  return error.code === 'PGRST301' || error.code === '401' || /JWT|token .*expired|not authenticated/i.test(String(error.message || ''));
}

/** RPC com o login do operador (um relogin de cortesia se a sessão expirou). */
export async function rpcOperador(fn, args) {
  let sb = await conectado();
  let { data, error } = await sb.rpc(fn, args);
  if (sessaoMorta(error)) {
    cliente = null;
    sb = await conectado();
    ({ data, error } = await sb.rpc(fn, args));
  }
  if (error) {
    const msg = String(error.message || error);
    if (/Só vigia ativo/.test(msg)) {
      throw new Error('O login do Buriti operador não está ativo como automação: o Victor marca na página Usuários.');
    }
    throw new Error(`RPC ${fn}: ${msg}`);
  }
  return data;
}
