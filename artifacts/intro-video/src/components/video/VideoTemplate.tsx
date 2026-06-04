import { motion, AnimatePresence } from 'framer-motion';
import { useVideoPlayer } from '@/lib/video';
import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';
import { Scene5 } from './video_scenes/Scene5';

const SCENE_DURATIONS = {
  intro: 3500,
  cashclip: 4500,
  absustain: 4500,
  backend: 4000,
  outro: 4000,
};

export default function VideoTemplate() {
  const { currentScene } = useVideoPlayer({ durations: SCENE_DURATIONS });
  const networkBg = `${import.meta.env.BASE_URL}videos/network-bg.mp4`;

  return (
    <div className="relative w-full h-[100vh] overflow-hidden bg-[#020617] text-slate-50 font-['Plus_Jakarta_Sans']">
      {/* Persistent Background Layer */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        <video 
          src={networkBg} 
          autoPlay 
          muted 
          loop 
          playsInline 
          className="absolute inset-0 w-full h-full object-cover opacity-20 mix-blend-screen"
        />
        
        {/* Dynamic color bleeds */}
        <motion.div
          className="absolute w-[80vw] h-[80vw] rounded-full blur-[120px] mix-blend-screen pointer-events-none"
          animate={{
            x: ['-20%', '30%', '-10%', '50%', '-20%'][currentScene] || '-20%',
            y: ['-10%', '20%', '-30%', '10%', '-10%'][currentScene] || '-10%',
            scale: [1, 1.2, 0.9, 1.4, 1][currentScene] || 1,
            background: [
              'radial-gradient(circle, #38bdf8, transparent)', 
              'radial-gradient(circle, #10b981, transparent)', 
              'radial-gradient(circle, #3b82f6, transparent)', 
              'radial-gradient(circle, #8b5cf6, transparent)', 
              'radial-gradient(circle, #0ea5e9, transparent)'
            ][currentScene] || 'radial-gradient(circle, #38bdf8, transparent)',
            opacity: [0.15, 0.25, 0.2, 0.3, 0.2][currentScene] || 0.15
          }}
          transition={{ duration: 2, ease: [0.22, 1, 0.36, 1] }}
        />
        <motion.div
          className="absolute w-[60vw] h-[60vw] rounded-full blur-[100px] mix-blend-screen right-0 bottom-0 pointer-events-none"
          animate={{
            x: ['20%', '-20%', '10%', '-30%', '20%'][currentScene] || '20%',
            y: ['10%', '-30%', '20%', '-10%', '10%'][currentScene] || '10%',
            scale: [0.9, 1.3, 1, 1.1, 0.9][currentScene] || 0.9,
            background: [
              'radial-gradient(circle, #818cf8, transparent)', 
              'radial-gradient(circle, #34d399, transparent)', 
              'radial-gradient(circle, #60a5fa, transparent)', 
              'radial-gradient(circle, #c084fc, transparent)', 
              'radial-gradient(circle, #38bdf8, transparent)'
            ][currentScene] || 'radial-gradient(circle, #818cf8, transparent)',
            opacity: [0.15, 0.2, 0.15, 0.25, 0.15][currentScene] || 0.15
          }}
          transition={{ duration: 2, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>

      {/* Persistent Midground Layer (Grid/Lines) */}
      <motion.div 
        className="absolute inset-0 z-0 opacity-10"
        style={{ backgroundImage: 'linear-gradient(#ffffff 1px, transparent 1px), linear-gradient(90deg, #ffffff 1px, transparent 1px)', backgroundSize: '4vw 4vw' }}
        animate={{
          y: currentScene * 20,
          opacity: currentScene === 3 ? 0.2 : 0.05
        }}
        transition={{ duration: 2 }}
      />

      <motion.div
        className="absolute h-[2px] z-10 blur-[1px]"
        animate={{
          left: ['-10%', '10%', '30%', '5%', '25%'][currentScene] || '-10%',
          width: ['120%', '40%', '40%', '90%', '50%'][currentScene] || '120%',
          top: ['50%', '85%', '15%', '60%', '50%'][currentScene] || '50%',
          background: [
            'linear-gradient(90deg, transparent, #38bdf8, transparent)',
            'linear-gradient(90deg, transparent, #10b981, transparent)',
            'linear-gradient(90deg, transparent, #3b82f6, transparent)',
            'linear-gradient(90deg, transparent, #8b5cf6, transparent)',
            'linear-gradient(90deg, transparent, #0ea5e9, transparent)'
          ][currentScene] || 'linear-gradient(90deg, transparent, #38bdf8, transparent)',
          opacity: [0.4, 0.8, 0.7, 0.5, 0.6][currentScene] || 0.4,
        }}
        transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
      />
      
      {/* Dynamic traveling particle */}
      <motion.div
        className="absolute w-[1vw] h-[1vw] rounded-full bg-white shadow-[0_0_20px_#fff] z-10"
        animate={{
          x: ['40vw', '25vw', '50vw', '45vw', '50vw'][currentScene] || '40vw',
          y: ['49vw', '84vw', '14vw', '59vw', '49vw'][currentScene] || '49vw',
          scale: [0, 1, 1.5, 0.8, 0][currentScene] || 0
        }}
        transition={{ duration: 1.5, ease: [0.22, 1, 0.36, 1] }}
      />

      {/* Foreground Scenes */}
      <div className="relative z-20 w-full h-full">
        <AnimatePresence mode="popLayout">
          {currentScene === 0 && <Scene1 key="intro" />}
          {currentScene === 1 && <Scene2 key="cashclip" />}
          {currentScene === 2 && <Scene3 key="absustain" />}
          {currentScene === 3 && <Scene4 key="backend" />}
          {currentScene === 4 && <Scene5 key="outro" />}
        </AnimatePresence>
      </div>
    </div>
  );
}
