// Reemplaza estos dos valores por los de tu proyecto real de Supabase
// (Dashboard > Settings > API > Project URL / anon public key).
const SUPABASE_URL = 'https://TU-PROYECTO.supabase.co';
const SUPABASE_ANON_KEY = 'TU-ANON-KEY';

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
