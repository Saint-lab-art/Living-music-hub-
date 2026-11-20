import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
const $ = (id) => document.getElementById(id);
const state = { user: null, profile: null, artist: null, isAdmin: false, songs: [], favourites: new Set(), filtered: [], genre: 'All', currentIndex: -1, installPrompt: null };
const audio = $('audio');

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function message(id, text, error = false) {
  const el = $(id); if (!el) return;
  el.textContent = text; el.classList.toggle('error', error);
}
function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '0:00';
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}
function setConnection(text, ok = true) {
  const el = $('connectionStatus'); el.textContent = text; el.classList.toggle('offline', !ok);
}
function artistName(song) {
  const relation = song.artist_profiles;
  return Array.isArray(relation) ? relation[0]?.stage_name || 'Independent artist' : relation?.stage_name || 'Independent artist';
}
function songCard(song, index, isFavourite = false) {
  const artist = artistName(song);
  return `<article class="track">
    <div class="art">♫</div>
    <div class="track-meta"><b>${escapeHtml(song.title)}</b><small>${escapeHtml(artist)} · ${escapeHtml(song.genre || 'Other')}${song.language ? ` · ${escapeHtml(song.language)}` : ''}</small></div>
    <button class="play-track" data-play="${escapeHtml(song.id)}" aria-label="Play ${escapeHtml(song.title)}">▶</button>
    <button class="fav ${isFavourite ? 'active' : ''}" data-fav="${escapeHtml(song.id)}" aria-label="${isFavourite ? 'Remove favourite' : 'Add favourite'}">${isFavourite ? '♥' : '♡'}</button>
  </article>`;
}
function bindTrackButtons(container) {
  container.querySelectorAll('[data-play]').forEach((button) => button.addEventListener('click', () => playSong(button.dataset.play)));
  container.querySelectorAll('[data-fav]').forEach((button) => button.addEventListener('click', () => toggleFavourite(button.dataset.fav)));
}
function renderSongs() {
  const query = $('searchInput').value.trim().toLowerCase();
  state.filtered = state.songs.filter((song) => {
    const genreMatch = state.genre === 'All' || (song.genre || '').toLowerCase() === state.genre.toLowerCase();
    const haystack = `${song.title} ${artistName(song)} ${song.genre || ''} ${song.language || ''}`.toLowerCase();
    return genreMatch && haystack.includes(query);
  });
  $('trackCount').textContent = `${state.filtered.length} ${state.filtered.length === 1 ? 'track' : 'tracks'}`;
  const list = $('trackList');
  list.innerHTML = state.filtered.length ? state.filtered.map((song, i) => songCard(song, i, state.favourites.has(song.id))).join('') : `<div class="empty"><div class="empty-icon">♫</div><h3>No songs found yet</h3><p>Try another search or genre. New approved music will appear here.</p></div>`;
  bindTrackButtons(list);
}
async function loadSongs() {
  const { data, error } = await supabase.from('songs')
    .select('id,title,description,audio_path,cover_path,genre,language,duration_seconds,play_count,created_at,artist_profiles!songs_artist_id_fkey(stage_name,location,image_url)')
    .eq('status', 'published').order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  state.songs = data || [];
  renderSongs();
}
async function loadFavourites() {
  state.favourites.clear();
  if (state.user) {
    const { data, error } = await supabase.from('favorites').select('song_id').eq('user_id', state.user.id);
    if (error) throw error;
    (data || []).forEach((row) => state.favourites.add(row.song_id));
  }
  renderSongs();
  renderLibrary();
}
function renderLibrary() {
  const list = $('libraryList');
  if (!state.user) { list.innerHTML = '<p class="muted">Sign in to save and view your favourite songs.</p>'; return; }
  const songs = state.songs.filter((song) => state.favourites.has(song.id));
  list.innerHTML = songs.length ? songs.map((song) => songCard(song, 0, true)).join('') : '<p class="muted">Your favourite songs will appear here. Tap ♡ beside a song to save it.</p>';
  bindTrackButtons(list);
}
async function toggleFavourite(songId) {
  if (!state.user) { message('authStatus', 'Please create an account or sign in to save favourites.', true); document.querySelector('#account').scrollIntoView({behavior:'smooth'}); return; }
  if (state.favourites.has(songId)) {
    const { error } = await supabase.from('favorites').delete().eq('user_id', state.user.id).eq('song_id', songId);
    if (error) return message('authStatus', error.message, true);
    state.favourites.delete(songId);
  } else {
    const { error } = await supabase.from('favorites').insert({ user_id: state.user.id, song_id: songId });
    if (error) return message('authStatus', error.message, true);
    state.favourites.add(songId);
  }
  renderSongs(); renderLibrary();
}
async function playSong(songId) {
  const song = state.songs.find((item) => item.id === songId);
  if (!song) return;
  const { data, error } = await supabase.storage.from('music-audio').createSignedUrl(song.audio_path, 3600);
  if (error || !data?.signedUrl) { message('uploadStatus', 'This track could not be streamed. Please try again later.', true); return; }
  const nextIndex = state.songs.findIndex((item) => item.id === songId);
  state.currentIndex = nextIndex;
  audio.src = data.signedUrl;
  $('nowTitle').textContent = song.title;
  $('nowArtist').textContent = artistName(song);
  $('playerCover').textContent = '♫';
  $('playBtn').textContent = 'Ⅱ';
  try { await audio.play(); } catch { $('playBtn').textContent = '▶'; }
  if (state.user) await supabase.from('play_events').insert({ user_id: state.user.id, song_id: song.id });
}
async function playRelative(step) {
  if (!state.songs.length) return;
  const index = state.currentIndex < 0 ? 0 : (state.currentIndex + step + state.songs.length) % state.songs.length;
  await playSong(state.songs[index].id);
}
async function loadArtist() {
  if (!state.user) { state.artist = null; return; }
  const { data, error } = await supabase.from('artist_profiles').select('id,user_id,stage_name,bio,location,image_url,verified').eq('user_id', state.user.id).maybeSingle();
  if (error) throw error;
  state.artist = data;
  if (data) {
    const form = $('artistForm');
    form.elements.stage_name.value = data.stage_name || '';
    form.elements.bio.value = data.bio || '';
    form.elements.location.value = data.location || '';
  }
}
async function loadMySubmissions() {
  if (!state.artist) { $('mySubmissions').classList.add('hidden'); return; }
  const { data, error } = await supabase.from('songs').select('id,title,genre,status,created_at').eq('artist_id', state.artist.id).order('created_at', {ascending:false}).limit(30);
  if (error) throw error;
  $('mySubmissions').classList.remove('hidden');
  $('submissionList').innerHTML = data?.length ? data.map((song) => `<div class="submission-row"><span><b>${escapeHtml(song.title)}</b><small>${escapeHtml(song.genre || 'Other')} · ${new Date(song.created_at).toLocaleDateString()}</small></span><span class="status-pill ${escapeHtml(song.status)}">${escapeHtml(song.status)}</span></div>`).join('') : '<p class="muted">You have not submitted any songs yet.</p>';
}
async function checkAdmin() {
  state.isAdmin = false;
  if (!state.user) return;
  const { data, error } = await supabase.from('admin_users').select('user_id').eq('user_id', state.user.id).maybeSingle();
  if (error && error.code !== 'PGRST116') throw error;
  state.isAdmin = !!data;
  $('admin').classList.toggle('hidden', !state.isAdmin);
  if (state.isAdmin) await loadAdminQueue();
}
async function loadAdminQueue() {
  const { data, error } = await supabase.from('songs')
    .select('id,title,description,genre,audio_path,created_at,artist_profiles!songs_artist_id_fkey(stage_name,location)')
    .eq('status', 'pending').order('created_at', {ascending:true}).limit(100);
  if (error) throw error;
  const list = $('adminList');
  list.innerHTML = data?.length ? data.map((song) => `<article class="moderation-card"><div><b>${escapeHtml(song.title)}</b><small>${escapeHtml(artistName(song))} · ${escapeHtml(song.genre || 'Other')} · ${new Date(song.created_at).toLocaleDateString()}</small><p>${escapeHtml(song.description || '')}</p></div><div class="moderation-actions"><button class="primary" data-approve="${song.id}">Publish</button><button class="secondary" data-reject="${song.id}">Reject</button></div></article>`).join('') : '<div class="empty"><h3>No pending songs</h3><p>New artist submissions will appear here.</p></div>';
  list.querySelectorAll('[data-approve]').forEach((button) => button.addEventListener('click', () => moderateSong(button.dataset.approve, 'published')));
  list.querySelectorAll('[data-reject]').forEach((button) => button.addEventListener('click', () => moderateSong(button.dataset.reject, 'rejected')));
}
async function moderateSong(songId, status) {
  const { error } = await supabase.from('songs').update({ status, updated_at: new Date().toISOString() }).eq('id', songId);
  if (error) return message('authStatus', error.message, true);
  await loadAdminQueue(); await loadSongs();
}
async function refreshAccount() {
  const { data: { session } } = await supabase.auth.getSession();
  state.user = session?.user || null;
  $('authPanel').classList.toggle('hidden', !!state.user);
  $('signedInPanel').classList.toggle('hidden', !state.user);
  if (!state.user) {
    state.profile = null; state.artist = null; state.isAdmin = false;
    $('admin').classList.add('hidden'); $('mySubmissions').classList.add('hidden');
    $('accountName').textContent = 'Your account'; $('accountEmail').textContent = '';
    await loadFavourites(); return;
  }
  $('accountName').textContent = state.user.user_metadata?.full_name || state.user.email || 'Your account';
  $('accountEmail').textContent = state.user.email || '';
  const { data: profile } = await supabase.from('profiles').select('id,username,full_name').eq('id', state.user.id).maybeSingle();
  state.profile = profile;
  await loadArtist(); await loadFavourites(); await loadMySubmissions(); await checkAdmin();
}

$('signUpForm').addEventListener('submit', async (event) => {
  event.preventDefault(); const form = new FormData(event.currentTarget);
  message('authStatus', 'Creating your account…');
  const { data, error } = await supabase.auth.signUp({ email: form.get('email'), password: form.get('password'), options: { data: { full_name: form.get('full_name') }, emailRedirectTo: window.location.origin } });
  if (error) return message('authStatus', error.message, true);
  if (data.session) { await refreshAccount(); message('authStatus', 'Your account is ready. Welcome to Living Music Hub.'); }
  else message('authStatus', 'Account created. Please check your email and confirm your address, then sign in.');
  event.currentTarget.reset();
});
$('signInForm').addEventListener('submit', async (event) => {
  event.preventDefault(); const form = new FormData(event.currentTarget);
  message('authStatus', 'Signing you in…');
  const { error } = await supabase.auth.signInWithPassword({ email: form.get('email'), password: form.get('password') });
  if (error) return message('authStatus', error.message, true);
  await refreshAccount(); message('authStatus', 'You are signed in.'); event.currentTarget.reset();
});
$('forgotPassword').addEventListener('click', async () => {
  const email = $('signInForm').elements.email.value.trim();
  if (!email) return message('authStatus', 'Enter your email address in the sign-in form first.', true);
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
  message('authStatus', error ? error.message : 'Password reset instructions have been sent if the account exists.', !!error);
});
$('signOutBtn').addEventListener('click', async () => { await supabase.auth.signOut(); await refreshAccount(); message('authStatus', 'You have signed out.'); });
supabase.auth.onAuthStateChange((_event, _session) => { setTimeout(() => refreshAccount().catch((e) => message('authStatus', e.message, true)), 0); });

$('artistForm').addEventListener('submit', async (event) => {
  event.preventDefault(); if (!state.user) return message('artistStatus', 'Please sign in or create an account first.', true);
  const form = new FormData(event.currentTarget);
  const values = { user_id: state.user.id, stage_name: String(form.get('stage_name')).trim(), bio: String(form.get('bio') || '').trim(), location: String(form.get('location') || '').trim() };
  message('artistStatus', 'Saving artist profile…');
  const { error } = await supabase.from('artist_profiles').upsert(values, { onConflict: 'user_id' });
  if (error) return message('artistStatus', error.message, true);
  await loadArtist(); await loadMySubmissions(); message('artistStatus', 'Artist profile saved successfully.');
});
$('uploadForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.user) { message('uploadStatus', 'Please sign in before submitting music.', true); document.querySelector('#account').scrollIntoView({behavior:'smooth'}); return; }
  if (!state.artist) { message('uploadStatus', 'Save your artist profile before uploading a song.', true); document.querySelector('#artistForm').scrollIntoView({behavior:'smooth'}); return; }
  const form = new FormData(event.currentTarget); const file = form.get('audio');
  if (!(file instanceof File) || !file.size) return message('uploadStatus', 'Choose an audio file first.', true);
  if (file.size > 50 * 1024 * 1024) return message('uploadStatus', 'The audio file must be 50 MB or smaller.', true);
  if (!form.get('rights')) return message('uploadStatus', 'Please confirm that you own or are authorised to distribute this recording.', true);
  const allowed = ['audio/mpeg','audio/mp4','audio/aac','audio/wav','audio/ogg','audio/flac','audio/x-wav','audio/wave'];
  const ext = (file.name.split('.').pop() || 'mp3').toLowerCase();
  if (!allowed.includes(file.type) && !['mp3','m4a','aac','wav','ogg','flac'].includes(ext)) return message('uploadStatus', 'Unsupported audio format. Use MP3, M4A, AAC, WAV, OGG or FLAC.', true);
  const path = `${state.user.id}/${crypto.randomUUID()}.${ext}`;
  message('uploadStatus', 'Uploading audio securely…');
  const contentTypes = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac' };
  const contentType = allowed.includes(file.type) ? file.type : (contentTypes[ext] || 'audio/mpeg');
  const { error: storageError } = await supabase.storage.from('music-audio').upload(path, file, { contentType, upsert: false });
  if (storageError) return message('uploadStatus', storageError.message, true);
  const { error: insertError } = await supabase.from('songs').insert({
    artist_id: state.artist.id, title: String(form.get('title')).trim(), description: String(form.get('description') || '').trim(),
    audio_path: path, genre: String(form.get('genre') || 'Other'), language: String(form.get('language') || '').trim() || null,
    status: 'pending', rights_confirmed: true, rights_confirmed_at: new Date().toISOString()
  });
  if (insertError) {
    await supabase.storage.from('music-audio').remove([path]);
    return message('uploadStatus', insertError.message, true);
  }
  event.currentTarget.reset(); message('uploadStatus', 'Song submitted successfully. It will become publicly playable after the Living Music Hub review team approves it.');
  await loadMySubmissions();
});

$('searchInput').addEventListener('input', renderSongs);
$('genreChips').querySelectorAll('[data-genre]').forEach((chip) => chip.addEventListener('click', () => {
  state.genre = chip.dataset.genre;
  $('genreChips').querySelectorAll('.chip').forEach((el) => el.classList.toggle('active', el === chip)); renderSongs();
}));
document.querySelectorAll('[data-scroll]').forEach((button) => button.addEventListener('click', () => $(button.dataset.scroll).scrollIntoView({behavior:'smooth'})));
$('playBtn').addEventListener('click', async () => { if (!audio.src && state.songs.length) return playSong(state.songs[0].id); if (audio.paused) { await audio.play(); $('playBtn').textContent = 'Ⅱ'; } else { audio.pause(); $('playBtn').textContent = '▶'; } });
$('prevBtn').addEventListener('click', () => playRelative(-1)); $('nextBtn').addEventListener('click', () => playRelative(1));
audio.addEventListener('timeupdate', () => { $('currentTime').textContent = formatTime(audio.currentTime); $('duration').textContent = formatTime(audio.duration); $('progress').value = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0; });
audio.addEventListener('ended', () => playRelative(1)); audio.addEventListener('pause', () => { $('playBtn').textContent = '▶'; }); audio.addEventListener('play', () => { $('playBtn').textContent = 'Ⅱ'; });
$('progress').addEventListener('input', (event) => { if (audio.duration) audio.currentTime = (Number(event.target.value) / 100) * audio.duration; });

window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); state.installPrompt = event; $('installBtn').classList.remove('hidden'); });
$('installBtn').addEventListener('click', async () => { if (!state.installPrompt) return; state.installPrompt.prompt(); await state.installPrompt.userChoice; state.installPrompt = null; $('installBtn').classList.add('hidden'); });
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
$('year').textContent = new Date().getFullYear();

(async function init() {
  try {
    setConnection('Online service connected');
    await loadSongs();
    await refreshAccount();
  } catch (error) {
    setConnection('Connection issue', false);
    message('authStatus', error.message || 'Could not connect to the music service. Check your internet connection.', true);
  }
})();
