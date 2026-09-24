/** Offline domain surface — IndexedDB-backed saved plates and reading state. No React. */
export {
  OFFLINE_EVENT,
  isSaved,
  listSaved,
  noteView,
  readingState,
  removePlate,
  savePlate,
  savedBlobUrls,
  toggleFavourite,
} from './offlineStore.js'
