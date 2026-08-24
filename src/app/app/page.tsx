import { redirect } from 'next/navigation'

/**
 * Дашборд появится здесь в срезе 6. Пока корень кабинета ведёт на ленту:
 * оставлять заглушку на маршруте, куда попадают сразу после входа, —
 * значит встречать блогера пустым экраном.
 */
export default function AppPage() {
  redirect('/app/reels')
}
