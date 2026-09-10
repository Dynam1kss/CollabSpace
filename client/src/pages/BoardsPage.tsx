import { logout } from '../api/auth';
import { useAuthStore } from '../store/auth-store';

export function BoardsPage() {
  const { user, setUser } = useAuthStore();

  const handleLogout = async () => {
    await logout();
    setUser(null);
  };

  return (
    <div>
      <header>
        <span>{user?.displayName}</span>
        <button type="button" onClick={handleLogout}>Вийти</button>
      </header>
      <h1>Мої дошки</h1>
      <p>Тут буде список дошок.</p>
    </div>
  );
}
