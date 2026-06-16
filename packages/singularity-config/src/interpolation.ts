/** Error class for interpolation failures */
export class InterpolationError extends Error {
	name = "InterpolationError";
}

/**
 * Simple variable interpolation for config strings.
 * Supports {{path.to.value}} syntax using dot-notation.
 */
export function interpolate(
	template: string,
	context: Record<string, unknown>,
): string {
	return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
		const value = getNestedValue(context, path.trim());
		if (value === undefined) {
			throw new InterpolationError(`Undefined variable: ${match}`);
		}
		return String(value);
	});
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
	const parts = path.split(".");
	let current: unknown = obj;
	for (const part of parts) {
		if (current === null || current === undefined) return undefined;
		if (typeof current !== "object") return undefined;
		current = (current as Record<string, unknown>)[part];
	}
	return current;
}
