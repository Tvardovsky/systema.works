'use client';

import {useEffect} from 'react';

const DOTLOTTIE_SCRIPT_SRC = 'https://unpkg.com/@lottiefiles/dotlottie-wc@0.8.11/dist/dotlottie-wc.js';

export function LottieLoader() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (customElements.get('dotlottie-wc')) return;
    if (document.querySelector(`script[src="${DOTLOTTIE_SCRIPT_SRC}"]`)) return;

    const script = document.createElement('script');
    script.type = 'module';
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.src = DOTLOTTIE_SCRIPT_SRC;
    document.head.appendChild(script);
  }, []);

  return null;
}
