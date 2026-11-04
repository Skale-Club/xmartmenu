import { ownedAdminTransaction } from './admin-menus-runtime'
import type { AdminLocationContext, DeliveryZoneMutation, LocationMutation } from './admin-locations'
import { mutateAdminDeliveryZone, mutateAdminLocation, readAdminDeliveryZones, readAdminLocations, readAdminLocationsPage } from './admin-locations'

export const readOwnedLocationsPage = (context: AdminLocationContext) =>
  ownedAdminTransaction(false, query => readAdminLocationsPage(query, context))

export const readOwnedLocations = (context: AdminLocationContext) =>
  ownedAdminTransaction(false, query => readAdminLocations(query, context))

export const mutateOwnedLocation = (context: AdminLocationContext, mutation: LocationMutation) =>
  ownedAdminTransaction(true, query => mutateAdminLocation(query, context, mutation))

export const readOwnedDeliveryZones = (context: AdminLocationContext) =>
  ownedAdminTransaction(false, query => readAdminDeliveryZones(query, context))

export const mutateOwnedDeliveryZone = (context: AdminLocationContext, mutation: DeliveryZoneMutation) =>
  ownedAdminTransaction(true, query => mutateAdminDeliveryZone(query, context, mutation))
