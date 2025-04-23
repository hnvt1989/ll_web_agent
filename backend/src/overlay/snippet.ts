export const OVERLAY_FUNCTIONS_SCRIPT = `
  (() => {
    const PULSE_STYLE_ID = 'pulsing-ring-style';
    let highlightTimeoutId = null;
    let pulseTimeoutId = null;
    let currentElement = null;
    let originalStyle = '';

    // Inject CSS for pulsing animation if not already present
    if (!document.getElementById(PULSE_STYLE_ID)) {
      const styleSheet = document.createElement('style');
      styleSheet.id = PULSE_STYLE_ID;
      styleSheet.innerHTML = \
        '@keyframes pulse {' +
          '0% { box-shadow: 0 0 0 0 rgba(0, 123, 255, 0.7); }' +
          '70% { box-shadow: 0 0 0 10px rgba(0, 123, 255, 0); }' +
          '100% { box-shadow: 0 0 0 0 rgba(0, 123, 255, 0); }' +
        '}' +
        '.pulsing-ring-effect {' +
          'animation: pulse 1s ease-out;' +
          'border-radius: 5px; /* Optional: makes the pulse match element shape */' +
          'box-shadow: 0 0 0 0 rgba(0, 123, 255, 0.7);' +
        '}';
      document.head.appendChild(styleSheet);
    }

    function removeOverlay() {
      clearTimeout(pulseTimeoutId);
      clearTimeout(highlightTimeoutId);
      if (currentElement) {
          currentElement.classList.remove('pulsing-ring-effect');
          currentElement.style.outline = '';
          // Restore original style, careful about outline/transition
          const styleAttr = currentElement.getAttribute('style');
          if (styleAttr) {
              let currentStyles = styleAttr.split(';').map(s => s.trim()).filter(s => s);
              currentStyles = currentStyles.filter(s => !s.startsWith('outline') && !s.startsWith('transition'));
              const restoredStyleArr = (originalStyle || '').split(';').map(s => s.trim()).filter(s => s && !s.startsWith('outline') && !s.startsWith('transition'));
              const finalStyle = Array.from(new Set([...currentStyles, ...restoredStyleArr])).join('; ');

              if (finalStyle && finalStyle !== ';') {
                  currentElement.setAttribute('style', finalStyle);
              } else {
                  currentElement.removeAttribute('style');
              }
          } else if (originalStyle) {
              currentElement.setAttribute('style', originalStyle);
          } else {
              currentElement.removeAttribute('style');
          }
          // Clean up transition if needed
          requestAnimationFrame(() => {
            if (currentElement && currentElement.style.transition === 'outline 0.2s ease-in-out') {
              currentElement.style.transition = '';
            }
          });
          currentElement = null;
          originalStyle = '';
      }
      // Note: We don't remove the stylesheet itself, as other elements might use it.
      // Proper management would require reference counting or a different approach.
    }

    function highlightAndScroll(selector) {
      // Remove any previous overlay first
      removeOverlay();

      const element = document.querySelector(selector);
      if (!element) {
        console.error('Element not found for selector:', selector);
        return;
      }
      currentElement = element;
      originalStyle = element.getAttribute('style') || '';

      // Apply pulsing animation
      element.classList.add('pulsing-ring-effect');

      // Remove pulse and apply highlight after 1 second
      pulseTimeoutId = setTimeout(() => {
          element.classList.remove('pulsing-ring-effect');

          // Scroll into view
          element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });

          // Apply highlight style
          element.style.outline = '3px solid rgba(255, 0, 0, 0.7)'; // Red outline
          element.style.transition = 'outline 0.2s ease-in-out'; // Only transition outline

          // Schedule removal of highlight after a delay (2 seconds after pulse ends)
          highlightTimeoutId = setTimeout(removeOverlay, 2000); // Use removeOverlay for cleanup

      }, 1000); // Pulse duration
    }

    // Expose functions to the global scope
    window.__MCP_OVERLAY__ = {
        highlightAndScroll,
        removeOverlay
    };

  })()
`; 