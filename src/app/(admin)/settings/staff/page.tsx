export const dynamic = 'force-dynamic'

import StaffClient from './StaffClient'
import OwnedStaffManagement from '@/components/admin/OwnedStaffManagement'
import { ownedAuthSelected } from '@/lib/auth/owned-principal'
import { accountAdministrationSelected } from '@/lib/data/account-administration'

export default function StaffPage() {
  if(ownedAuthSelected()||accountAdministrationSelected())return <div className="p-6"><OwnedStaffManagement /></div>
  return <StaffClient />
}
