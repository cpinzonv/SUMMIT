import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { PaywallProvider } from './context/PaywallContext.jsx';
import 'katex/dist/katex.min.css';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <PaywallProvider>
          <App />
        </PaywallProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
