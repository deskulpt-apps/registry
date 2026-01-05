import spdxParse from "spdx-expression-parse";
import spdxSatisfies from "spdx-satisfies";

const ACCEPTED_LICENSES = ["Apache-2.0", "BSD-3-Clause", "MIT"];

export function extractLicenses(spdx: string) {
  const spdxIds = new Set<string>();
  const parsed = spdxParse(spdx);

  const nodeIsLicenseInfo = (
    node: spdxParse.Info,
  ): node is spdxParse.LicenseInfo =>
    (node as spdxParse.LicenseInfo).license !== undefined;

  const nodeIsConjunctionInfo = (
    node: spdxParse.Info,
  ): node is spdxParse.ConjunctionInfo =>
    (node as spdxParse.ConjunctionInfo).conjunction !== undefined;

  const visit = (node: spdxParse.Info) => {
    if (nodeIsLicenseInfo(node)) {
      const spdxId = node.plus ? `${node.license}+` : node.license;
      if (ACCEPTED_LICENSES.includes(spdxId)) {
        spdxIds.add(spdxId);
      }
    } else if (nodeIsConjunctionInfo(node)) {
      visit(node.left);
      visit(node.right);
    }
  };

  visit(parsed);
  return spdxIds;
}

export function isLicenseAccepted(spdx: string) {
  return spdxSatisfies(spdx, ACCEPTED_LICENSES);
}
