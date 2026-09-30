import { useEffect, useRef } from 'react';
import { EDIT_TEXT } from '../constants';
import './RowContextMenu.css';

const MENU_EDGE_GAP_PX = 8;
const MENU_ESTIMATED_SIZE_PX = { width: 170, height: 52 };

function RowContextMenu({ x, y, onEdit, onClose }) {
  const menuRef = useRef(null);

  useEffect(() => {
    function handlePointerDown(event) {
      if (!menuRef.current.contains(event.target)) {
        onClose();
      }
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onClose, true);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  // Keeps the menu on screen when the user right-clicks near the right or bottom edge.
  const left = Math.min(x, window.innerWidth - MENU_ESTIMATED_SIZE_PX.width - MENU_EDGE_GAP_PX);
  const top = Math.min(y, window.innerHeight - MENU_ESTIMATED_SIZE_PX.height - MENU_EDGE_GAP_PX);

  return (
    <div
      ref={menuRef}
      className="row-context-menu"
      role="menu"
      style={{ left, top }}
      data-testid="row-context-menu"
    >
      <button
        type="button"
        role="menuitem"
        className="row-context-menu__item"
        onClick={onEdit}
        data-testid="row-context-menu-edit"
      >
        {EDIT_TEXT.MENU_EDIT_ROW}
      </button>
    </div>
  );
}

export default RowContextMenu;
