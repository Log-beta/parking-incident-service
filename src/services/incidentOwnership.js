function isReportOwner(report, authenticatedUserId) {
  return typeof authenticatedUserId === "string" &&
    authenticatedUserId.trim().length > 0 &&
    report?.user_id === authenticatedUserId;
}

module.exports = { isReportOwner };
