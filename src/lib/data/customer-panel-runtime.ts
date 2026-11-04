import { getIdentityServices } from '../auth/identity-services'
import type { OwnedCustomer } from '../auth/owned-customer'
import { ordersDataOwned, OrderDataError } from './orders'
import { orderTransaction } from './orders-runtime'
import { CustomerPanelRepository } from './customer-panel'

export function readOwnedCustomerPanel(customer: OwnedCustomer,slug: string) {
  if (!ordersDataOwned()) throw new OrderDataError(503,'Independent orders must be enabled')
  return orderTransaction(getIdentityServices().pool,!!customer.phoneE164,query => new CustomerPanelRepository(query).panel(customer,slug))
}
