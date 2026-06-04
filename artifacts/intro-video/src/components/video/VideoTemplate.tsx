import { motion, AnimatePresence } from 'framer-motion';
import { useVideoPlayer } from '@/lib/video';
import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';
import { Scene5 } from './video_scenes/Scene5';

const SCENE_DURATIONS = {
  hook: 3500,
  earn: 4500,
  payout: 4000,
  trust: 3500,
  outro: 4500,
};

export default function VideoTemplate() {
  const { currentScene } = useVideoPlayer({ durations: SCENE_DURATIONS });
  const networkBg = `${import.meta.env.BASE_URL}videos/network-bg.mp4`;

  return (
    <div className="relative w-full h-[100vh] overflow-hidden bg-[#05050A] text-slate-50 font-['Plus_Jakarta_Sans']">
      {/* Persistent Background Layer */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        {/* Subtle noise texture */}
        <div 
          className="absolute inset-0 opacity-[0.04] mix-blend-overlay z-10"
          style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=%220 0 200 200%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22noiseFilter%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.65%22 numOctaves=%223%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23noiseFilter)%22/%3E%3C/svg%3E")' }}
        />
        
        <video 
          src={networkBg} 
          autoPlay 
          muted 
          loop 
          playsInline 
          className="absolute inset-0 w-full h-full object-cover opacity-20 mix-blend-screen filter contrast-125"
        />
        
        {/* Dynamic color bleeds */}
        <motion.div
          className="absolute w-[80vw] h-[80vw] rounded-full blur-[120px] mix-blend-screen pointer-events-none"
          animate={{
            x: ['-20%', '40%', '-10%', '60%', '-20%'][currentScene] || '-20%',
            y: ['-10%', '30%', '-20%', '10%', '-10%'][currentScene] || '-10%',
            scale: [1, 1.3, 0.9, 1.5, 1][currentScene] || 1,
            background: [
              'radial-gradient(circle, #00f260, transparent)', // Green
              'radial-gradient(circle, #0052ff, transparent)', // Blue
              'radial-gradient(circle, #00f260, transparent)', // Green
              'radial-gradient(circle, #0052ff, transparent)', // Blue
              'radial-gradient(circle, #00f260, transparent)'  // Green
            ][currentScene] || 'radial-gradient(circle, #00f260, transparent)',
            opacity: [0.15, 0.25, 0.15, 0.3, 0.2][currentScene] || 0.15
          }}
          transition={{ duration: 2.5, ease: [0.22, 1, 0.36, 1] }}
        />
        <motion.div
          className="absolute w-[70vw] h-[70vw] rounded-full blur-[100px] mix-blend-screen right-0 bottom-0 pointer-events-none"
          animate={{
            x: ['20%', '-30%', '15%', '-40%', '20%'][currentScene] || '20%',
            y: ['10%', '-20%', '30%', '-10%', '10%'][currentScene] || '10%',
            scale: [0.9, 1.4, 1, 1.2, 0.9][currentScene] || 0.9,
            background: [
              'radial-gradient(circle, #0052ff, transparent)', // Blue
              'radial-gradient(circle, #00f260, transparent)', // Green
              'radial-gradient(circle, #0052ff, transparent)', // Blue
              'radial-gradient(circle, #00f260, transparent)', // Green
              'radial-gradient(circle, #0052ff, transparent)'  // Blue
            ][currentScene] || 'radial-gradient(circle, #0052ff, transparent)',
            opacity: [0.1, 0.2, 0.1, 0.25, 0.15][currentScene] || 0.1
          }}
          transition={{ duration: 3, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>

      {/* Persistent Midground Layer (Grid/Lines) */}
      <motion.div 
        className="absolute inset-0 z-0 opacity-[0.05]"
        style={{ backgroundImage: 'linear-gradient(#ffffff 1px, transparent 1px), linear-gradient(90deg, #ffffff 1px, transparent 1px)', backgroundSize: '3vw 3vw' }}
        animate={{
          y: currentScene * 15,
          scale: currentScene === 4 ? 1.15 : 1
        }}
        transition={{ duration: 2, ease: [0.22, 1, 0.36, 1] }}
      />

      <motion.div
        className="absolute h-[2px] z-10 blur-[1px]"
        animate={{
          left: ['-20%', '20%', '40%', '10%', '30%'][currentScene] || '-20%',
          width: ['140%', '30%', '50%', '80%', '40%'][currentScene] || '140%',
          top: ['45%', '80%', '20%', '65%', '50%'][currentScene] || '45%',
          background: [
            'linear-gradient(90deg, transparent, #00f260, transparent)',
            'linear-gradient(90deg, transparent, #0052ff, transparent)',
            'linear-gradient(90deg, transparent, #00f260, transparent)',
            'linear-gradient(90deg, transparent, #0052ff, transparent)',
            'linear-gradient(90deg, transparent, #00f260, transparent)'
          ][currentScene] || 'linear-gradient(90deg, transparent, #00f260, transparent)',
          opacity: [0.4, 0.7, 0.6, 0.8, 0.6][currentScene] || 0.4,
        }}
        transition={{ duration: 2.2, ease: [0.16, 1, 0.3, 1] }}
      />

      {/* Foreground Scenes */}
      <div className="relative z-20 w-full h-full">
        <AnimatePresence mode="popLayout">
          {currentScene === 0 && <Scene1 key="hook" />}
          {currentScene === 1 && <Scene2 key="earn" />}
          {currentScene === 2 && <Scene3 key="payout" />}
          {currentScene === 3 && <Scene4 key="trust" />}
          {currentScene === 4 && <Scene5 key="outro" />}
        </AnimatePresence>
      </div>
    </div>
  );
}
