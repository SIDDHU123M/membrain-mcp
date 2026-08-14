import { createRoot } from 'react-dom/client';
import '@fontsource-variable/fraunces';
import '@fontsource-variable/inter';
import './styles.css';
import App from './App.js';
import Login from './Login.js';
import Privacy from './Privacy.js';

// pre-auth routes used by the hosted ledger; everything else is the app
const path = window.location.pathname;
const Root = path === '/login' ? Login : path === '/privacy' ? Privacy : App;

createRoot(document.getElementById('root')!).render(<Root />);
