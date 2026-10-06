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
    $('#wCity').textContent = 'Hava durumu';
    $('#wStamp').textContent = '';
    $('#wBody').innerHTML = '<p class="muted">⚙ Ayarlardan bir şehir seç.</p>';
    return;
  }
  $('#wCity').textContent = city.name;
  const cache = settings.weatherCache;
  const cacheValid = cache && cache.lat === city.lat && cache.lon === city.lon;
  if (cacheValid) renderWeather(cache.data, cache.at, false);
  if (!force && cacheValid && Date.now() - cache.at < WEATHER_TTL) return;

  const url = 'https://api.open-meteo.com/v1/forecast?' + new URLSearchParams({
    latitude: city.lat, longitude: city.lon, timezone: 'auto', forecast_days: 4,
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max',
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

function renderWeather(d, at, offline) {
  const c = d.current, day = d.daily;
  const [icon, desc] = wmo(c.weather_code, !!c.is_day);
  const r = Math.round;
  const hm = s => (s ? s.slice(11, 16) : '—');
  const rain = day.precipitation_probability_max || [];
  const chip = (i, label, val) => `<span class="chip">${img(i)}<span class="l">${label}</span><b>${val}</b></span>`;

  const days = day.time.slice(1, 4).map((t, i) => {
    const k = i + 1;
    const date = new Date(t + 'T12:00');
    const name = k === 1 ? 'Yarın' : fmtWeekday.format(date);
    const [di, dd] = wmo(day.weather_code[k]);
    const rp = rain[k];
    return `<div class="w-day" title="${name}: ${dd}">
      <div class="d">${name}</div>
      <div class="dt">${fmtShortDate.format(date)}</div>
      ${img(di, 'i', false, dd)}
      <div class="desc">${dd}</div>
      <div class="t"><span class="hi">${r(day.temperature_2m_max[k])}°</span><span class="lo">${r(day.temperature_2m_min[k])}°</span></div>
      <div class="r" title="Yağış ihtimali">${rp ? `${img('raindrop')}%${rp}` : ''}</div>
    </div>`;
  }).join('');

  $('#wBody').innerHTML = `
    <div class="w-left">
      <div class="w-now">
        ${img(icon, 'w-icon', true, desc)}
        <div class="w-temp">${r(c.temperature_2m)}°</div>
        <div class="w-info">
          <div class="w-desc">${desc}</div>
          <div class="w-feel">Hissedilen ${r(c.apparent_temperature)}°</div>
          <div class="w-feel">Bugün <span class="hi">↑ ${r(day.temperature_2m_max[0])}°</span> &nbsp;<span class="lo">↓ ${r(day.temperature_2m_min[0])}°</span></div>
        </div>
      </div>
      <div class="chips">
        ${chip('raindrop', 'Yağış', `%${rain[0] ?? 0}`)}
        ${chip('humidity', 'Nem', `%${c.relative_humidity_2m}`)}
        ${chip('wind', 'Rüzgar', `${r(c.wind_speed_10m)} km/s`)}
      </div>
      <div class="chips">
        ${chip('sunrise', 'Gün doğumu', hm(day.sunrise[0]))}
        ${chip('sunset', 'Gün batımı', hm(day.sunset[0]))}
      </div>
    </div>
    <div class="w-days">${days}</div>`;
  $('#wStamp').textContent = `${offline ? '⚠ Çevrimdışı · ' : ''}${fmtTime.format(new Date(at))}`;
  $('#wStamp').title = 'Son güncelleme';
}
