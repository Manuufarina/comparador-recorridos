// Descarga el KML del mapa de Google My Maps en build-time y genera public/datos.js
// Sin dependencias: usa fetch nativo de Node 18+ y parseo por regex.
const fs = require('fs');
const MID = '10S3NtuWx1DioZSuOT5Y_gpcHMKducXk';
const URL_KML = `https://www.google.com/maps/d/kml?mid=${MID}&forcekml=1`;

function decodificarEntidades(s){
  return s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&').trim();
}

(async () => {
  const res = await fetch(URL_KML, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error('No se pudo descargar el KML: HTTP ' + res.status);
  const kml = await res.text();

  // 1) Estilos: id -> color de línea (KML usa aabbggrr)
  const estilos = {};
  for (const m of kml.matchAll(/<Style id="([^"]+)">([\s\S]*?)<\/Style>/g)){
    const lin = m[2].match(/<LineStyle>[\s\S]*?<color>([0-9a-fA-F]{8})<\/color>/);
    if (lin){
      const c = lin[1]; // aabbggrr
      estilos[m[1]] = '#' + c.slice(6,8) + c.slice(4,6) + c.slice(2,4);
    }
  }
  // 2) StyleMaps: id -> style id (tomamos el "normal")
  const mapas = {};
  for (const m of kml.matchAll(/<StyleMap id="([^"]+)">([\s\S]*?)<\/StyleMap>/g)){
    const n = m[2].match(/<key>normal<\/key>\s*<styleUrl>#([^<]+)<\/styleUrl>/);
    if (n) mapas[m[1]] = n[1];
  }
  const colorDe = (ref) => {
    let id = ref.replace(/^#/,'');
    if (mapas[id]) id = mapas[id];
    return (estilos[id] || '#3a3a3a').toLowerCase();
  };

  // 3) Carpetas -> Placemarks con LineString
  const capas = [];
  for (const f of kml.matchAll(/<Folder>([\s\S]*?)<\/Folder>/g)){
    const cuerpo = f[1];
    const nombre = decodificarEntidades((cuerpo.match(/<name>([\s\S]*?)<\/name>/) || [,''])[1]);
    const tramos = [];
    for (const p of cuerpo.matchAll(/<Placemark>([\s\S]*?)<\/Placemark>/g)){
      const pm = p[1];
      const linea = pm.match(/<LineString>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/);
      if (!linea) continue;
      const ref = (pm.match(/<styleUrl>([^<]+)<\/styleUrl>/) || [,''])[1];
      const coords = linea[1].trim().split(/\s+/).map(t => {
        const [lng, lat] = t.split(',').map(Number);
        return [Math.round(lat*1e6)/1e6, Math.round(lng*1e6)/1e6];
      }).filter(c => Number.isFinite(c[0]) && Number.isFinite(c[1]));
      if (coords.length > 1) tramos.push({ color: colorDe(ref), coords });
    }
    if (tramos.length) capas.push({ nombre, tramos });
  }
  if (!capas.length) throw new Error('El KML no trajo capas con recorridos: revisar que el mapa siga público.');

  fs.mkdirSync('public', { recursive: true });
  fs.writeFileSync('public/datos.js', 'const CAPAS_RAW = ' + JSON.stringify(capas) + ';\n');
  fs.copyFileSync('index.html', 'public/index.html');
  const total = capas.reduce((s,c)=>s+c.tramos.length,0);
  console.log(`OK: ${capas.length} capas, ${total} tramos -> public/datos.js`);
})().catch(e => { console.error(e.message); process.exit(1); });
