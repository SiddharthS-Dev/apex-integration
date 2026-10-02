import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '@/App';
import '@/index.css';

try {
  if (localStorage.getItem('theme') === 'dark') document.documentElement.classList.add('dark');
} catch {
  // storage unavailable — default to light theme
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
