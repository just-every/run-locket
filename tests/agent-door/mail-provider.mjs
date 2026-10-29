// Configure the disposable installation's real mail adapter. Only the paid
// provider edge is replaced by rer verify; native invitation proof stays intact.
export default async function () {
  return 'resend'
}
