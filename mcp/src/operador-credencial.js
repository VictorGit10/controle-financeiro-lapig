// Parte pura da credencial do Buriti operador (sem SDK): testável no CI da raiz.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
