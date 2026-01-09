const defaultValues = {
	interface: "north",
	unitsCount: 0,
	madrabNum: 55,
	meterPrice: 1000,
	unitArea: 375,
};

let totalUnitsCount = 0;
let defaultMapData = [];

const cache = {};

const ANIMATION_DURATION = 2000;

function syncGlow(element) {
	element.style("animation-delay", `-${Date.now() % ANIMATION_DURATION}ms`);
}

function saveData(key, value) {
	localStorage.setItem(key, value);
	cache[key] = value;
}

async function importMap() {
	const svgFile = await d3.xml("assets/images/new-final-map.svg");
	const svgNode = document.importNode(svgFile.documentElement, true);

	const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
	g.setAttribute("id", "map-content");

	// Move all child nodes into the new group
	while (svgNode.firstChild) {
		g.appendChild(svgNode.firstChild);
	}

	svgNode.appendChild(g);
	svgNode.setAttribute("id", "map");
	document.querySelector(".map-container").appendChild(svgNode);
}

function getMapData(data) {
	try {
		const parsed = data || JSON.parse(localStorage.getItem("map-data"));
		if (Array.isArray(parsed) && parsed.length === totalUnitsCount) {
			return parsed;
		}
	} catch { }
	return defaultMapData;
}

function getValues(data) {
	try {
		const values = data || JSON.parse(localStorage.getItem("values"));
		if (
			Object.hasOwnProperty.call(values, "unitsCount") &&
			Object.hasOwnProperty.call(values, "madrabNum") &&
			Object.hasOwnProperty.call(values, "meterPrice") &&
			Object.hasOwnProperty.call(values, "unitArea") &&
			Object.hasOwnProperty.call(values, "interface")
		) {
			return values;
		}
	} catch { }
	return defaultValues;
}

function getTransform(data) {
	try {
		const transform = data || JSON.parse(localStorage.getItem("transform"));
		if (
			!Number.isNaN(transform.x) &&
			!Number.isNaN(transform.y) &&
			!Number.isNaN(transform.k)
		) {
			return transform;
		}
	} catch { }
	return { x: 0, y: 0, k: 1 };
}

async function setupMap(events) {
	function setData(data) {
		saveData("map-data", JSON.stringify(data));
		events?.mapData?.(data);
		try {
			const values = getValues();
			const unitsCount = data.filter((d) => d === "selected").length;
			const newValues = {
				...values,
				unitsCount,
			};
			saveData("values", JSON.stringify(newValues));
			events?.values?.(newValues);
		} catch { }

		// TODO: trigger event (which should be handled by the dashboard)
	}

	// states: initial, selected, completed
	await importMap();

	const zoom = d3.zoom().scaleExtent([1, 8]).on("zoom", zoomed);
	const svg = d3.select("#map").call(zoom);

	// Select all yellow units (st0, st2, and st3 all have fill #ffe98f in new map)
	const units = svg
		.selectAll(".st0, .st2, .st3")
		.on("click", clicked)
		.on("dblclick", dblClicked);

	// Dynamically determine unit count
	totalUnitsCount = units.size();
	defaultMapData = new Array(totalUnitsCount).fill("initial");

	// Clear localStorage if unit count changed (to reset stale data)
	const storedData = localStorage.getItem("map-data");
	if (storedData) {
		try {
			const parsed = JSON.parse(storedData);
			if (!Array.isArray(parsed) || parsed.length !== totalUnitsCount) {
				localStorage.removeItem("map-data");
			}
		} catch {
			localStorage.removeItem("map-data");
		}
	}

	const initialData = getMapData();
	setData(initialData);

	// disable interactive with the numbers over the units
	svg.selectAll("text")
		.classed("no-mouse", true)
		.style("pointer-events", "none");



	// Disable pointer events on all non-unit elements that might overlay units
	// These elements sit on top of units and block clicks
	svg.selectAll(".st1, .st4, .st5, .st6, .st7, .st8, .st9, .st14, .st15, .st16, .st17, .st18, .st19, .st20, .st21, .st22, .st25, .st26")
		.style("pointer-events", "none");

	// Helper to get rotation from transform string
	function getRotation(transform) {
		const match = transform && transform.match(/rotate\(([^)]+)\)/);
		return match ? match[1] : null;
	}

	// Center unit number labels within their corresponding yellow units
	// We include more classes to catch all potential unit numbers (st5-st11 based on observed classes)
	const unitNumberTexts = svg.selectAll("text.st5, text.st6, text.st7, text.st8, text.st9, text.st10, text.st11");
	unitNumberTexts.each(function () {
		const textEl = d3.select(this);
		const textContent = textEl.text().trim();

		// Only process if it looks like a number (unit number)
		// Some street names or other text might share classes
		if (!/^\d+$/.test(textContent)) return;

		// Parse the transform attribute to get actual position
		const transform = textEl.attr("transform") || "";
		// Identify rotation
		const rotation = getRotation(transform);

		const translateMatch = transform.match(/translate\(([^,\s]+)[,\s]+([^)]+)\)/);
		if (!translateMatch) return;

		const textX = parseFloat(translateMatch[1]);
		const textY = parseFloat(translateMatch[2]);

		// Find the unit that contains or is nearest to this text
		let nearestUnit = null;
		let minDistance = Infinity;

		units.each(function () {
			const unitBBox = this.getBBox();
			const unitCenterX = unitBBox.x + unitBBox.width / 2;
			const unitCenterY = unitBBox.y + unitBBox.height / 2;

			const dx = textX - unitCenterX;
			const dy = textY - unitCenterY;
			const distance = Math.sqrt(dx * dx + dy * dy);

			if (distance < minDistance) {
				minDistance = distance;
				nearestUnit = this;
			}
		});

		// If we found a nearby unit (within reasonable distance), center the text in it
		if (nearestUnit && minDistance < 50) { // Reduced from 500 to 50 to prevent grabbing neighbors
			const unitBBox = nearestUnit.getBBox();
			const unitCenterX = unitBBox.x + unitBBox.width / 2;
			const unitCenterY = unitBBox.y + unitBBox.height / 2;

			// Set text-anchor to middle for horizontal centering
			textEl.attr("text-anchor", "middle")
				.attr("dominant-baseline", "central");

			// Apply new transform with center position (PRESERVING rotation)
			let newTransform = `translate(${unitCenterX}, ${unitCenterY})`;
			if (rotation) {
				newTransform += ` rotate(${rotation})`;
			}
			textEl.attr("transform", newTransform);

			// Reset tspan positioning since we're using text-anchor now
			textEl.select("tspan").attr("x", 0).attr("y", 0);
		}
	});

	// Enable pointer events on units and apply initial state
	units
		.style("pointer-events", "all")
		.style("cursor", "pointer")
		.data(initialData)
		.each(function (d) {
			this.classList.add("unit");
			this.classList.add(d);
			if (d === "selected") {
				syncGlow(d3.select(this));
			} else {
				d3.select(this).style("animation-delay", null);
			}
		});

	// Get building circles and their positions
	const buildingCircles = svg.selectAll(".building-circle");
	const buildings = [];
	buildingCircles.each(function () {
		const circle = d3.select(this);
		buildings.push({
			id: circle.attr("data-building"),
			cx: parseFloat(circle.attr("cx")),
			cy: parseFloat(circle.attr("cy")),
			element: this,
			boundaryPolygon: null // Will be assigned below
		});
	});

	// Get building boundary polygons (st17 class in new map - these are the actual building block boundaries)
	const buildingBoundaries = svg.selectAll("polygon.st17");

	// Helper function to check if a point is inside a polygon
	function pointInPolygon(x, y, polygon) {
		const pointsAttr = polygon.getAttribute("points");
		if (!pointsAttr) return false; // Skip if no points attribute (e.g., path elements)
		const points = pointsAttr.trim().split(/\s+/);
		const vertices = [];
		for (let i = 0; i < points.length; i += 2) {
			vertices.push({
				x: parseFloat(points[i]),
				y: parseFloat(points[i + 1])
			});
		}

		let inside = false;
		for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
			const xi = vertices[i].x, yi = vertices[i].y;
			const xj = vertices[j].x, yj = vertices[j].y;

			if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
				inside = !inside;
			}
		}
		return inside;
	}

	// Assign boundary polygon to each building by checking which polygon contains the building circle center
	for (const building of buildings) {
		buildingBoundaries.each(function () {
			if (pointInPolygon(building.cx, building.cy, this)) {
				building.boundaryPolygon = this;
			}
		});
	}

	// Center building number labels (st12 class in new map) within their white circles
	const buildingNumberTexts = svg.selectAll("text.st12");
	buildingNumberTexts.each(function () {
		const textEl = d3.select(this);

		// Parse the transform attribute to get actual position
		const transform = textEl.attr("transform") || "";
		const rotation = getRotation(transform);

		const translateMatch = transform.match(/translate\(([^,\s]+)[,\s]+([^)]+)\)/);
		if (!translateMatch) return;

		const textX = parseFloat(translateMatch[1]);
		const textY = parseFloat(translateMatch[2]);

		// Find the building circle nearest to this text
		let nearestCircle = null;
		let minDistance = Infinity;

		buildingCircles.each(function () {
			const circle = d3.select(this);
			const cx = parseFloat(circle.attr("cx"));
			const cy = parseFloat(circle.attr("cy"));

			const dx = textX - cx;
			const dy = textY - cy;
			const distance = Math.sqrt(dx * dx + dy * dy);

			if (distance < minDistance) {
				minDistance = distance;
				nearestCircle = this;
			}
		});

		// If we found a nearby circle, center the text in it
		if (nearestCircle && minDistance < 100) {
			const circle = d3.select(nearestCircle);
			const cx = parseFloat(circle.attr("cx"));
			const cy = parseFloat(circle.attr("cy"));

			// Set text-anchor to middle for horizontal centering
			textEl.attr("text-anchor", "middle")
				.attr("dominant-baseline", "central");

			// Apply new transform with center position
			let newTransform = `translate(${cx}, ${cy})`;
			if (rotation) {
				newTransform += ` rotate(${rotation})`;
			}
			textEl.attr("transform", newTransform);

			// Reset tspan positioning since we're using text-anchor now
			textEl.select("tspan").attr("x", 0).attr("y", 0);
		}
	});

	// Center service/amenity labels (st13 class) within their corresponding shapes
	// Potential backgrounds: st16 (green), st21 (brown), st25 (dark blue), st26 (teal)
	// We select both polygons and paths
	const servicesBackgrounds = svg.selectAll(".st16, .st21, .st25, .st26");
	const serviceTexts = svg.selectAll("text.st13");

	serviceTexts.each(function () {
		const textEl = d3.select(this);
		// textEl.style("font-family", "TheYearofTheCamel"); // Using CSS instead

		// Parse transform
		const transform = textEl.attr("transform") || "";
		const rotation = getRotation(transform);
		const translateMatch = transform.match(/translate\(([^,\s]+)[,\s]+([^)]+)\)/);
		if (!translateMatch) return;

		const textX = parseFloat(translateMatch[1]);
		const textY = parseFloat(translateMatch[2]);

		let nearestShape = null;
		let minDistance = Infinity;

		servicesBackgrounds.each(function () {
			const bbox = this.getBBox();
			const cx = bbox.x + bbox.width / 2;
			const cy = bbox.y + bbox.height / 2;

			const dx = textX - cx;
			const dy = textY - cy;
			const distance = Math.sqrt(dx * dx + dy * dy);

			if (distance < minDistance) {
				minDistance = distance;
				nearestShape = this;
			}
		});

		// Threshold can be larger here because service buildings are large
		if (nearestShape && minDistance < 1000) {
			const bbox = nearestShape.getBBox();
			const cx = bbox.x + bbox.width / 2;
			const cy = bbox.y + bbox.height / 2;

			textEl.attr("text-anchor", "middle")
				.attr("dominant-baseline", "central");

			let newTransform = `translate(${cx}, ${cy})`;
			if (rotation) {
				newTransform += ` rotate(${rotation})`;
			}
			textEl.attr("transform", newTransform);

			textEl.select("tspan").attr("x", 0).attr("y", 0);
		}
	});



	// Calculate center point of each unit and assign to building whose boundary contains it
	units.each(function () {
		const bbox = this.getBBox();
		const centerX = bbox.x + bbox.width / 2;
		const centerY = bbox.y + bbox.height / 2;

		// First, try to find building whose boundary polygon contains this unit
		let assignedBuilding = null;
		for (const building of buildings) {
			if (building.boundaryPolygon && pointInPolygon(centerX, centerY, building.boundaryPolygon)) {
				assignedBuilding = building.id;
				break;
			}
		}

		// Fallback to nearest building if no boundary contains the unit
		if (!assignedBuilding) {
			let minDistance = Infinity;
			for (const building of buildings) {
				const dx = centerX - building.cx;
				const dy = centerY - building.cy;
				const distance = Math.sqrt(dx * dx + dy * dy);

				if (distance < minDistance) {
					minDistance = distance;
					assignedBuilding = building.id;
				}
			}
		}

		if (assignedBuilding) {
			this.setAttribute("data-building", assignedBuilding);
		}
	});

	// Add click handler for building circles
	buildingCircles
		.style("cursor", "pointer")
		.style("pointer-events", "all")
		.on("click", function (event) {
			event.stopPropagation();
			const buildingId = d3.select(this).attr("data-building");

			// Find all units belonging to this building
			const buildingUnits = units.filter(function () {
				return this.getAttribute("data-building") === buildingId;
			});

			// Check if all are already selected
			let allSelected = true;
			buildingUnits.each(function () {
				const datum = d3.select(this).datum();
				if (datum !== "selected") {
					allSelected = false;
				}
			});

			// Toggle: if all selected, deselect all; otherwise select all
			buildingUnits.each(function () {
				const element = d3.select(this);
				const currentState = element.datum();

				// Only toggle if unit is in initial or selected state
				if (currentState === "initial" || currentState === "selected") {
					element.each(function (d) {
						this.classList.remove(d);
					});

					const newState = allSelected ? "initial" : "selected";
					element.datum(newState).each(function (d) {
						this.classList.add(d);
						if (d === "selected") {
							syncGlow(d3.select(this));
						} else {
							d3.select(this).style("animation-delay", null);
						}
					});
				}
			});

			setData(units.data());
		});

	function clicked(event, d) {
		event.stopPropagation();

		if (d === "initial") {
			const element = d3.select(this);
			// change data to selected if equals initial
			element.each(function (d) {
				this.classList.remove(d);
			});
			element.datum("selected").each(function (d) {
				this.classList.add(d);
				syncGlow(d3.select(this));
			});
			events?.unitClicked?.(element);
		}

		if (d === "selected") {
			const element = d3.select(this);
			// change data to initial if equals selected
			element.each(function (d) {
				this.classList.remove(d);
			});
			element.datum("initial").each(function (d) {
				this.classList.add(d);
				d3.select(this).style("animation-delay", null);
			});
		}

		setData(units.data());
	}

	function dblClicked(event, d) {
		event.stopPropagation();
		if (d === "completed") {
			const element = d3.select(this);
			// change data to selected if equals initial
			element.each(function (d) {
				this.classList.remove(d);
			});
			element.datum("initial").each(function (d) {
				this.classList.add(d);
				d3.select(this).style("animation-delay", null);
			});
		}

		setData(units.data());
	}

	function zoomed(event) {
		const { transform } = event;
		svg.select("#map-content").attr("transform", transform);
		saveData("transform", JSON.stringify(transform));
		events?.transform?.(transform);
	}

	function dataChanged(key, value) {
		let parsed;
		try {
			parsed = JSON.parse(value);
		} catch {
			return;
		}
		cache[key] = value;
		if (key === "map-data") {
			const data = getMapData(parsed);
			units.data(data).each(function (d) {
				this.classList.remove("initial", "selected", "completed");
				this.classList.add("unit");
				this.classList.add(d);
				if (d === "selected") {
					syncGlow(d3.select(this));
				} else {
					d3.select(this).style("animation-delay", null);
				}
			});
			events?.mapData?.(data);
		} else if (key === "values") {
			const data = getValues(parsed);
			events?.values?.(data);
		} else if (key === "transform") {
			const data = getTransform(parsed);
			svg.call(
				zoom.transform,
				d3.zoomIdentity.translate(data.x, data.y).scale(data.k),
			);
			events?.transform?.(data);
		}
	}

	setInterval(() => {
		const keys = ["map-data", "values", "transform"];
		for (const key of keys) {
			const stored = localStorage.getItem(key);
			if (stored !== cache[key]) {
				dataChanged(key, stored);
			}
		}
	}, 500);



	return {
		svg,
		units,
	};
}
