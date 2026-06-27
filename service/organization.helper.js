import { Store } from "../models/index.js";

export async function getOrganizationByCode(code) {
  if (!code) {
    throw new Error("organization code is required");
  }

  const organization = await Store.findOne({
    where: { organization_code: code },
  });

  if (!organization) {
    throw new Error(`Invalid organization code: ${code}`);
  }

  return organization;
}

export async function resolveOrganizationIdByCode(code) {
  const organization = await getOrganizationByCode(code);
  return organization.id;
}