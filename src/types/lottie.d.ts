import type {DetailedHTMLProps, HTMLAttributes} from 'react';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'dotlottie-wc': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string;
        type?: string;
        autoplay?: boolean;
        loop?: boolean;
        speed?: string;
      };
    }
  }
}
