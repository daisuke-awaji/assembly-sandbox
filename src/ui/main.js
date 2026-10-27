import { startApp } from './app.js';
import { render } from '../markdown/index.js';
import { createNotesStore } from '../store/notes.js';
import { createLocalStorage } from '../store/storage.js';

startApp({ document, store: createNotesStore(createLocalStorage()), render });
