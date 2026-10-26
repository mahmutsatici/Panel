// Hava durumu (Open-Meteo + Meteocons simgeleri)
// {dn} → gündüz/gece varyantı
const WMO = {
  0: ['clear-{dn}', 'Açık'], 1: ['partly-cloudy-{dn}', 'Az bulutlu'], 2: ['partly-cloudy-{dn}', 'Parçalı bulutlu'], 3: ['overcast', 'Kapalı'],
  45: ['fog-{dn}', 'Sisli'], 48: ['fog-{dn}', 'Kırağılı sis'],
  51: ['drizzle', 'Hafif çisenti'], 53: ['drizzle', 'Çisenti'], 55: ['drizzle', 'Yoğun çisenti'],
  56: ['sleet', 'Donan çisenti'], 57: ['sleet', 'Donan çisenti'],
  61: ['partly-cloudy-{dn}-rain', 'Hafif yağmur'], 63: ['rain', 'Yağmurlu'], 65: ['rain', 'Şiddetli yağmur'],
  66: ['sleet', 'Donan yağmur'], 67: ['sleet', 'Donan yağmur'],
  71: ['partly-cloudy-{dn}-snow', 'Hafif kar'], 73: ['snow', 'Karlı'], 75: ['snow', 'Yoğun kar'], 77: ['snow', 'Kar taneleri'],
  80: ['partly-cloudy-{dn}-rain', 'Sağanak'], 81: ['rain', 'Kuvvetli sağanak'], 82: ['thunderstorms-rain', 'Şiddetli sağanak'],
  85: ['partly-cloudy-{dn}-snow', 'Kar sağanağı'], 86: ['snow', 'Yoğun kar sağanağı'],
  95: ['thunderstorms-{dn}-rain', 'Gök gürültülü fırtına'], 96: ['hail', 'Dolulu fırtına'], 99: ['hail', 'Şiddetli dolu'],
};
const wmo = (code, day = true) => {
  const [icon, desc] = WMO[code] || ['not-available', '—'];
  return [icon.replace('{dn}', day ? 'day' : 'night'), desc];
};
// Büyük simge hafif animasyonlu, küçükler sabit (göz yormasın)
const OWN_ICONS = new Set(['sunrise', 'sunset']); // src/icons altındaki kendi çizimlerimiz
const iconSrc = (name, animated = false) =>
  appUrl(OWN_ICONS.has(name) ? `icons/${name}.svg` : `vendor/weather/${animated ? 'anim' : 'static'}/${name}.svg`);
const img = (name, cls = '', animated = false, alt = '') => `<img class="${cls}" src="${iconSrc(name, animated)}" alt="${alt}" draggable="false">`;

const WEATHER_TTL = 30 * 60 * 1000;
const fmtWeekday = new Intl.DateTimeFormat('tr-TR', { weekday: 'long' });
const fmtShortDate = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' });
const fmtTime = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' });

async function loadWeather(force = false) {
  const city = settings.city;
  if (!city) {
    $('#wCity').textContent = '';
    $('#wStamp').textContent = '';
    $('#wBody').innerHTML = '<p class="muted">⚙ Ayarlardan bir şehir seç.</p>';
    return;
  }
  $('#wCity').textContent = city.name;
  const cache = settings.weatherCache;
  const cacheValid = cache && cache.lat === city.lat && cache.lon === city.lon;
  if (cacheValid) renderWeather(cache.data, cache.at, false);
  if (!force && cacheValid && cache.data.hourly && Date.now() - cache.at < WEATHER_TTL) return;

  const url = 'https://api.open-meteo.com/v1/forecast?' + new URLSearchParams({
    latitude: city.lat, longitude: city.lon, timezone: 'auto', forecast_days: 7, forecast_hours: 24,
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,is_day,pressure_msl,cloud_cover,uv_index',
    hourly: 'temperature_2m,precipitation_probability,weather_code,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max,precipitation_sum,uv_index_max,wind_speed_10m_max',
  });
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    const at = Date.now();
    settings = await api.settings.set({ weatherCache: { lat: city.lat, lon: city.lon, at, data } });
    renderWeather(data, at, false);
  } catch {
    if (cacheValid) renderWeather(cache.data, cache.at, true);
    else $('#wBody').innerHTML = '<p class="muted">Hava durumu alınamadı. İnternet bağlantını kontrol et.</p>';
  }
}

// Panoda yalnızca ana bilgiler (şu an + bugün + yağış/nem/rüzgar); tam ekranda (body.solo) ayrıntılar da
// görünür: kutucuklar, 24 saatlik akış ve 7 günlük tahmin. Ayrıntılar CSS ile gizlenir (.w-full).
const WIND_DIRS = ['K', 'KD', 'D', 'GD', 'G', 'GB', 'B', 'KB'];
const windDir = deg => WIND_DIRS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
const uvLevel = uv => (uv < 3 ? 'düşük' : uv < 6 ? 'orta' : uv < 8 ? 'yüksek' : uv < 11 ? 'çok yüksek' : 'aşırı');

function renderWeather(d, at, offline) {
  const c = d.current, day = d.daily, hr = d.hourly;
  const [icon, desc] = wmo(c.weather_code, !!c.is_day);
  const r = Math.round;
  const hm = s => (s ? s.slice(11, 16) : '—');
  const rain = day.precipitation_probability_max || [];
  const chip = (i, label, val) => `<span class="chip">${img(i)}<span class="l">${label}</span><b>${val}</b></span>`;
  const tile = (i, label, val, sub = '') => `<div class="w-tile">${img(i)}<div><span>${label}</span><b>${val}</b>${sub ? `<small>${sub}</small>` : ''}</div></div>`;

  // Tam ekran: kutucuklar (eski önbellekte olmayan alanlar "—" görünür)
  const has = v => v !== undefined && v !== null;
  const tiles = [
    tile('thermometer', 'Hissedilen', `${r(c.apparent_temperature)}°`),
    tile('humidity', 'Nem', `%${c.relative_humidity_2m}`),
    tile('wind', 'Rüzgar', `${r(c.wind_speed_10m)} km/s`, has(c.wind_direction_10m) ? `${windDir(c.wind_direction_10m)} yönünden` : ''),
    tile('barometer', 'Basınç', has(c.pressure_msl) ? `${r(c.pressure_msl)} hPa` : '—'),
    tile('cloudy', 'Bulut', has(c.cloud_cover) ? `%${c.cloud_cover}` : '—'),
    tile('uv-index', 'UV indeksi', has(c.uv_index) ? `${r(c.uv_index)}` : '—', has(c.uv_index) ? uvLevel(c.uv_index) : ''),
    tile('umbrella', 'Bugün yağış', `%${rain[0] ?? 0}`, day.precipitation_sum ? `${day.precipitation_sum[0]} mm` : ''),
    tile('sunrise', 'Gün doğumu', hm(day.sunrise[0])),
    tile('sunset', 'Gün batımı', hm(day.sunset[0])),
  ].join('');

  // 24 saatlik akış
  const hours = hr ? hr.time.map((t, i) => {
    const [hi] = wmo(hr.weather_code[i], !!hr.is_day[i]);
    const p = hr.precipitation_probability?.[i];
    return `<div class="w-hour${i === 0 ? ' now' : ''}"><span>${i === 0 ? 'Şimdi' : t.slice(11, 16)}</span>${img(hi)}<b>${r(hr.temperature_2m[i])}°</b><small>${p ? `%${p}` : ''}</small></div>`;
  }).join('') : '';

  // 7 gün: en düşük–en yüksek aralığı haftanın genel aralığına göre çubukla gösterilir
  const lo = Math.min(...day.temperature_2m_min), hiAll = Math.max(...day.temperature_2m_max), span = Math.max(1, hiAll - lo);
  const week = day.time.map((t, k) => {
    const date = new Date(t + 'T12:00');
    const name = k === 0 ? 'Bugün' : k === 1 ? 'Yarın' : fmtWeekday.format(date);
    const [di, dd] = wmo(day.weather_code[k]);
    const mn = day.temperature_2m_min[k], mx = day.temperature_2m_max[k];
    return `<div class="w-row">
      <span class="w-name">${name}<small>${fmtShortDate.format(date)}</small></span>
      ${img(di)}<span class="w-rdesc">${dd}</span>
      <span class="w-rain">${rain[k] ? `${img('raindrop')}%${rain[k]}` : ''}</span>
      <span class="lo">${r(mn)}°</span>
      <span class="w-range"><i style="left:${((mn - lo) / span) * 100}%;right:${((hiAll - mx) / span) * 100}%"></i></span>
      <span class="hi">${r(mx)}°</span>
    </div>`;
  }).join('');

  $('#wBody').innerHTML = `
    <div class="w-now">
      ${img(icon, 'w-icon', true, desc)}
      <div class="w-temp">${r(c.temperature_2m)}°</div>
      <div class="w-info">
        <div class="w-desc">${desc}</div>
        <div class="w-feel">Hissedilen ${r(c.apparent_temperature)}°</div>
        <div class="w-feel">Bugün <span class="hi">↑ ${r(day.temperature_2m_max[0])}°</span> &nbsp;<span class="lo">↓ ${r(day.temperature_2m_min[0])}°</span></div>
      </div>
    </div>
    <div class="chips w-basic">
      ${chip('raindrop', 'Yağış', `%${rain[0] ?? 0}`)}
      ${chip('humidity', 'Nem', `%${c.relative_humidity_2m}`)}
      ${chip('wind', 'Rüzgar', `${r(c.wind_speed_10m)} km/s`)}
    </div>
    <div class="w-full">
      <div class="w-tiles">${tiles}</div>
      ${hours ? `<section><h3>Önümüzdeki 24 saat</h3><div class="w-hours">${hours}</div></section>` : ''}
      <section><h3>${day.time.length} günlük tahmin</h3><div class="w-week">${week}</div></section>
    </div>`;
  $('#wStamp').textContent = `${offline ? '⚠ Çevrimdışı · ' : ''}${fmtTime.format(new Date(at))}`;
  $('#wStamp').title = 'Son güncelleme';
}
