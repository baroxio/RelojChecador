// Arranque: carga la librería de Supabase y entrega la interfaz.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";
import { iniciarApp } from "./ui.js";

const sinConfigurar = !SUPABASE_KEY || SUPABASE_KEY.startsWith("PEGAR_");
const sb = sinConfigurar
  ? null
  : createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });

iniciarApp({
  sb,
  url: SUPABASE_URL,
  key: SUPABASE_KEY,
  raiz: document.getElementById("app"),
  avisos: document.getElementById("avisos"),
});
