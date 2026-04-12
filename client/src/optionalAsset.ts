export async function loadOptionalAsset<TAsset, TRequest>(
  loader: (request: TRequest) => Promise<TAsset>,
  request: TRequest,
  warning: string,
  logger: Pick<Console, "warn"> = console,
): Promise<TAsset | null> {
  try {
    return await loader(request);
  } catch (error) {
    logger.warn(warning, error);
    return null;
  }
}
