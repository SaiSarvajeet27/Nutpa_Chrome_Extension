import React, { useEffect, useRef, useCallback, useMemo } from 'react';
import { gsap } from 'gsap';
import './TargetCursor.css';

interface TargetCursorProps {
  targetSelector?: string;
  spinDuration?: number;
  hideDefaultCursor?: boolean;
  hoverDuration?: number;
  parallaxOn?: boolean;
  cursorColor?: string;
  cursorColorOnTarget?: string;
}

const TargetCursor: React.FC<TargetCursorProps> = ({
  targetSelector = '.cursor-target',
  spinDuration = 2,
  hideDefaultCursor = true,
  hoverDuration = 0.2,
  parallaxOn = true,
  cursorColor = '#ffffff',
  cursorColorOnTarget
}) => {
  const cursorRef = useRef<HTMLDivElement | null>(null);
  const cornersRef = useRef<NodeListOf<HTMLDivElement> | null>(null);
  const spinTl = useRef<gsap.core.Timeline | null>(null);
  const dotRef = useRef<HTMLDivElement | null>(null);

  const isActiveRef = useRef(false);
  const targetCornerPositionsRef = useRef<{ x: number; y: number }[] | null>(null);
  const tickerFnRef = useRef<(() => void) | null>(null);
  const activeStrengthRef = useRef(0);


  const constants = useMemo(
    () => ({
      borderWidth: 3,
      cornerSize: 12
    }),
    []
  );

  const moveCursor = useCallback((x: number, y: number) => {
    if (!cursorRef.current) return;
    gsap.to(cursorRef.current, {
      x: x,
      y: y,
      duration: 0.1,
      ease: 'power3.out'
    });
  }, []);

  useEffect(() => {
    if (!cursorRef.current) return;

    const cursor = cursorRef.current;
    cornersRef.current = cursor.querySelectorAll('.target-cursor-corner');

    let activeTarget: HTMLElement | null = null;
    let resumeTimeout: any = null;

    // Set initial position and hide the custom cursor (opacity: 0)
    gsap.set(cursor, {
      xPercent: -50,
      yPercent: -50,
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
      opacity: 0
    });

    const createSpinTimeline = () => {
      if (spinTl.current) {
        spinTl.current.kill();
      }
      spinTl.current = gsap
        .timeline({ repeat: -1 })
        .to(cursor, { rotation: '+=360', duration: spinDuration, ease: 'none' });
    };

    createSpinTimeline();

    const tickerFn = () => {
      if (!targetCornerPositionsRef.current || !cursorRef.current || !cornersRef.current) {
        return;
      }

      const strength = activeStrengthRef.current;
      if (strength === 0) return;

      const cursorX = gsap.getProperty(cursorRef.current, 'x') as number;
      const cursorY = gsap.getProperty(cursorRef.current, 'y') as number;

      const corners = Array.from(cornersRef.current);
      corners.forEach((corner, i) => {
        const currentX = gsap.getProperty(corner, 'x') as number;
        const currentY = gsap.getProperty(corner, 'y') as number;

        const targetX = targetCornerPositionsRef.current![i].x - cursorX;
        const targetY = targetCornerPositionsRef.current![i].y - cursorY;

        // central LERP for smooth bracket snapping inside ticker loop
        const lerpFactor = 0.25 * strength;
        const finalX = currentX + (targetX - currentX) * lerpFactor;
        const finalY = currentY + (targetY - currentY) * lerpFactor;

        gsap.set(corner, {
          x: finalX,
          y: finalY
        });
      });
    };

    tickerFnRef.current = tickerFn;

    let lastX = window.innerWidth / 2;
    let lastY = window.innerHeight / 2;

    const updateHoverState = (clientX: number, clientY: number, directTarget: HTMLElement | null) => {
      moveCursor(clientX, clientY);

      // Find if we are inside a target element matching targetSelector
      let current = directTarget;
      let target: HTMLElement | null = null;
      while (current && current !== document.body) {
        if (current.matches && current.matches(targetSelector)) {
          target = current;
          break;
        }
        current = current.parentElement;
      }

      if (target) {
        // We are hovering a target!
        if (activeTarget !== target) {
          if (resumeTimeout) {
            clearTimeout(resumeTimeout);
            resumeTimeout = null;
          }

          activeTarget = target;
          
          if (hideDefaultCursor) {
            document.body.classList.add('is-targeting');
          }
          
          gsap.to(cursor, { opacity: 1, duration: 0.15, ease: 'power2.out' });

          const corners = Array.from(cornersRef.current!);
          corners.forEach(corner => gsap.killTweensOf(corner, 'x,y'));

          gsap.killTweensOf(cursor, 'rotation');
          spinTl.current?.pause();
          gsap.set(cursor, { rotation: 0 });

          if (cursorColorOnTarget) {
            gsap.to(corners, {
              borderColor: cursorColorOnTarget,
              duration: 0.15,
              ease: 'power2.out'
            });
            if (dotRef.current) {
              gsap.to(dotRef.current, {
                backgroundColor: cursorColorOnTarget,
                duration: 0.15,
                ease: 'power2.out'
              });
            }
          }

          const rect = target.getBoundingClientRect();
          const { borderWidth, cornerSize } = constants;
          const cursorX = gsap.getProperty(cursor, 'x') as number;
          const cursorY = gsap.getProperty(cursor, 'y') as number;

          targetCornerPositionsRef.current = [
            { x: rect.left - borderWidth, y: rect.top - borderWidth },
            { x: rect.right + borderWidth - cornerSize, y: rect.top - borderWidth },
            { x: rect.right + borderWidth - cornerSize, y: rect.bottom + borderWidth - cornerSize },
            { x: rect.left - borderWidth, y: rect.bottom + borderWidth - cornerSize }
          ];

          isActiveRef.current = true;
          gsap.ticker.add(tickerFnRef.current!);

          gsap.to(activeStrengthRef, {
            current: 1,
            duration: hoverDuration,
            ease: 'power2.out'
          });

          corners.forEach((corner, i) => {
            gsap.to(corner, {
              x: targetCornerPositionsRef.current![i].x - cursorX,
              y: targetCornerPositionsRef.current![i].y - cursorY,
              duration: 0.2,
              ease: 'power2.out'
            });
          });
        } else {
          // If already hovering, check if target size or position changed
          const rect = target.getBoundingClientRect();
          const { borderWidth, cornerSize } = constants;
          
          targetCornerPositionsRef.current = [
            { x: rect.left - borderWidth, y: rect.top - borderWidth },
            { x: rect.right + borderWidth - cornerSize, y: rect.top - borderWidth },
            { x: rect.right + borderWidth - cornerSize, y: rect.bottom + borderWidth - cornerSize },
            { x: rect.left - borderWidth, y: rect.bottom + borderWidth - cornerSize }
          ];
        }
      } else {
        // We are NOT hovering a target!
        if (activeTarget) {
          activeTarget = null;
          
          gsap.ticker.remove(tickerFnRef.current!);
          isActiveRef.current = false;
          targetCornerPositionsRef.current = null;
          gsap.set(activeStrengthRef, { current: 0, overwrite: true });

          if (hideDefaultCursor) {
            document.body.classList.remove('is-targeting');
          }
          
          gsap.to(cursor, { opacity: 0, duration: 0.15, ease: 'power2.out' });

          if (cursorColorOnTarget && cornersRef.current) {
            gsap.to(Array.from(cornersRef.current), {
              borderColor: cursorColor,
              duration: 0.15,
              ease: 'power2.out'
            });
            if (dotRef.current) {
              gsap.to(dotRef.current, {
                backgroundColor: cursorColor,
                duration: 0.15,
                ease: 'power2.out'
              });
            }
          }

          if (cornersRef.current) {
            const corners = Array.from(cornersRef.current);
            gsap.killTweensOf(corners, 'x,y');
            const { cornerSize } = constants;
            const positions = [
              { x: -cornerSize * 1.5, y: -cornerSize * 1.5 },
              { x: cornerSize * 0.5, y: -cornerSize * 1.5 },
              { x: cornerSize * 0.5, y: cornerSize * 0.5 },
              { x: -cornerSize * 1.5, y: cornerSize * 0.5 }
            ];
            const tl = gsap.timeline();
            corners.forEach((corner, index) => {
              tl.to(
                corner,
                {
                  x: positions[index].x,
                  y: positions[index].y,
                  duration: 0.3,
                  ease: 'power3.out'
                },
                0
              );
            });
          }

          resumeTimeout = setTimeout(() => {
            if (!activeTarget && cursorRef.current && spinTl.current) {
              const currentRotation = gsap.getProperty(cursor, 'rotation') as number;
              const normalizedRotation = currentRotation % 360;
              spinTl.current.kill();
              spinTl.current = gsap
                .timeline({ repeat: -1 })
                .to(cursor, { rotation: '+=360', duration: spinDuration, ease: 'none' });
              gsap.to(cursor, {
                rotation: normalizedRotation + 360,
                duration: spinDuration * (1 - normalizedRotation / 360),
                ease: 'none',
                onComplete: () => {
                  spinTl.current?.restart();
                }
              });
            }
            resumeTimeout = null;
          }, 50);
        }
      }
    };

    const moveHandler = (e: MouseEvent) => {
      lastX = e.clientX;
      lastY = e.clientY;
      updateHoverState(e.clientX, e.clientY, e.target as HTMLElement | null);
    };

    window.addEventListener('mousemove', moveHandler);

    const scrollHandler = () => {
      const elementUnderMouse = document.elementFromPoint(lastX, lastY) as HTMLElement | null;
      updateHoverState(lastX, lastY, elementUnderMouse);
    };
    window.addEventListener('scroll', scrollHandler, { passive: true });

    const mouseDownHandler = () => {
      if (!dotRef.current) return;
      gsap.to(dotRef.current, { scale: 0.7, duration: 0.3 });
      gsap.to(cursor, { scale: 0.9, duration: 0.2 });
    };

    const mouseUpHandler = () => {
      if (!dotRef.current) return;
      gsap.to(dotRef.current, { scale: 1, duration: 0.3 });
      gsap.to(cursor, { scale: 1, duration: 0.2 });
    };

    window.addEventListener('mousedown', mouseDownHandler);
    window.addEventListener('mouseup', mouseUpHandler);


    return () => {
      if (tickerFnRef.current) {
        gsap.ticker.remove(tickerFnRef.current);
      }

      window.removeEventListener('mousemove', moveHandler);
      window.removeEventListener('scroll', scrollHandler);
      window.removeEventListener('mousedown', mouseDownHandler);
      window.removeEventListener('mouseup', mouseUpHandler);
      document.body.classList.remove('is-targeting');

      isActiveRef.current = false;
      targetCornerPositionsRef.current = null;
      activeStrengthRef.current = 0;

      spinTl.current?.kill();
    };
  }, [
    targetSelector,
    spinDuration,
    moveCursor,
    constants,
    hideDefaultCursor,
    hoverDuration,
    parallaxOn,
    cursorColor,
    cursorColorOnTarget
  ]);

  return (
    <div ref={cursorRef} className="target-cursor-wrapper">
      <div ref={dotRef} className="target-cursor-dot" style={{ backgroundColor: cursorColor }} />
      <div className="target-cursor-corner corner-tl" style={{ borderColor: cursorColor }} />
      <div className="target-cursor-corner corner-tr" style={{ borderColor: cursorColor }} />
      <div className="target-cursor-corner corner-br" style={{ borderColor: cursorColor }} />
      <div className="target-cursor-corner corner-bl" style={{ borderColor: cursorColor }} />
    </div>
  );
};

export default TargetCursor;
