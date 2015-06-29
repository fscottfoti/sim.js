var buildings_types = {
    HS: 1,
    HT: 2,
    MF: 3
};


var rent_own = {
    own: 1,
    rent: 2
};


var CONFIG = {
    poor_threshold: 20000,
    height_per_story: 12,
    footprint_efficiency: .7,
    building_efficiency: .8,
    ave_unit_size: 1000,
    relocation_rate: .05
};


Sim = {
    init: function () {

        this.d = {};
        this.d.zones = {};

        return Promise.all([
            new Promise(this.loadLogsums),
            new Promise(this.loadJson)
        ]);

    },


    loadLogsums: function (resolve, reject) {
        d3.csv("data/logsums.csv", function (d) {
            Sim.d.logsums = _.object(_.map(d, function(obj) {
                return [+obj.taz, obj];
            }));
            resolve();
        });
    },


    loadJson: function (resolve, reject) {
        d3.json("data/hay2.json", function (e, d) {
            if (e) return reject(e);
            _.extend(Sim.d, d);
            resolve();
        });
    },


    // like pandas describe
    describe: function (arr, attr) {
        if (attr) {
            arr = _.map(arr, function (item) {
                return item[attr];
            })
        }

        arr = arr.sort(function (a, b) {
            return a - b
        });

        var fmt = function (n) {
            return numeral(n).format('0,0');
        };

        console.log("min: " + fmt(d3.quantile(arr, 0.0)));
        console.log("25%: " + fmt(d3.quantile(arr, 0.25)));
        console.log("median: " + fmt(d3.quantile(arr, 0.5)));
        console.log("75%: " + fmt(d3.quantile(arr, 0.75)));
        console.log("max: " + fmt(d3.quantile(arr, 1.0)));
    },


    // convert object to array for use in d3 (which uses arrays)
    _obj2arr: function (obj) {
        return _.map(obj, function (val, key) {
            return val;
        });
    },


    // this takes the output form a d3 rollup and adds it to Sim.d[name]
    d3RollupToObject: function (arr, name) {
        _.each(arr, function (val) {
            var key = val.key;

            if (!Sim.d[name][key])
                Sim.d[name][key] = {};

            _.extend(Sim.d[name][key], val.values);
        });
    },


    zoneHouseholdVars: function () {

        // these are zone variables we get by rolling up households to zones
        data = d3.nest()
            .key(function (d) {
                return Sim.d.buildings[d.building_id].zone_id;
            }).rollup(function (d) {
                return {
                    "ave_income": d3.mean(d, function (e) {
                        return +e.income;
                    }),
                    "poor": d3.sum(d, function (e) {
                        return e.income < CONFIG.poor_threshold;
                    }),
                    "renters": d3.sum(d, function (e) {
                        return e.hownrent == rent_own.rent;
                    })
                };
            }).entries(Sim._obj2arr(Sim.d.households));

        Sim.d3RollupToObject(data, "zones");
    },


    zoneBuildingVars: function () {

        // these are zone variables we get by rolling up buildings to zones
        data = d3.nest()
            .key(function (d) {
                return +d.zone_id;
            }).rollup(function (d) {
                return {
                    "sum_residential_units": d3.sum(d, function (e) {
                        return +e.residential_units;
                    }),
                    "sum_non_residential_units": d3.sum(d, function (e) {
                        return +e.non_residential_units;
                    }),
                    "ave_stories": d3.mean(d, function (e) {
                        return +e.stories;
                    }),
                    "sfdu": d3.sum(d, function (e) {
                        return +e.residential_units * +e.building_type_id == buildings_types.HS;
                    })
                };
            }).entries(Sim._obj2arr(Sim.d.buildings));

        Sim.d3RollupToObject(data, "zones");
    },


    allZoneVars: function () {
        this.zoneHouseholdVars();
        this.zoneBuildingVars();
    },


    zonePriceVars: function () {

        // these are price zone variables we get by rolling up buildings to zones
        data = d3.nest()
            .key(function (d) {
                return +d.zone_id;
            }).rollup(function (d) {
                return {
                    "ave_residential_price": d3.mean(d, function (e) {
                        return +e.residential_price;
                    })
                };
            }).entries(Sim._obj2arr(Sim.d.buildings));

        Sim.d3RollupToObject(data, "zones");
    },


    rsh: function () {
        _.each(Sim.d.buildings, function (b, id, obj) {
            var p = 0,
                z = +b.zone_id;

            // building attributes
            p += (+b.year_built < 1940) * 0.1033682688375832;
            p += (+b.year_built > 2000) * -0.006005524050255999;
            p += Math.log1p(+b.building_sqft / Math.max(1, +b.residential_units)) * -0.45907905026951035;
            p += Math.log1p(+Sim.d.parcels[+b.parcel_id].parcel_size / Math.max(1, +b.residential_units)) * 0.0776791124037567;

            // constant
            p += 2.57048634107115;

            // logsums
            p += Sim.d.logsums[z].autoOffPeakRetail * -0.281197051832964;
            p += Sim.d.logsums[z].autoPeakTotal * 0.3307628135825661;
            p += Sim.d.logsums[z].transitPeakTotal * 0.012124801890625493;

            // zone household aggregations
            p += Math.log1p(Sim.d.zones[z].ave_income) * 0.4389761139847244;
            p += Math.log1p(Sim.d.zones[z].poor) * -0.04725225454921351;
            p += Math.log1p(Sim.d.zones[z].renters) * 0.16895038525397293;

            // zone building aggregations
            p += Math.log1p(Sim.d.zones[z].sfdu) * -0.08556828228865788;
            p += Sim.d.zones[z].ave_stories * 0.08567483620381938;
            p += Math.log1p(Sim.d.zones[z].sum_non_residential_units) * 0.0053824618073246115; // buildings
            p += Math.log1p(Sim.d.zones[z].sum_residential_units) * -0.03159639166738088;

            p = Math.clip(Math.exp(p), 250, 1250);
            // outcome variable
            obj[id].residential_price = p;
        });

        Sim.describe(Sim.d.buildings, "residential_price");
    },


    // returns index of choice, given the pdf
    weightedChoice: function (pdf) {
        var r = Math.random();
        for (var i = 0 ; i < pdf.length ; i ++) {
            r -= pdf[i];
            if( r < 0 ) {
                return i;
            }
        }
        console.log('FATAL: weights probably not normalized');
    },


    // the actual choice part of a DCM
    logitChoice: function (chooser, alternatives, utility_func) {

        exp_utils = _.map(alternatives, function (alt) {
            return Math.exp(utility_func(chooser, alt));
        });

        var sum_exp_utils = d3.sum(exp_utils);
        var probs = _.map(exp_utils, function (exp_util) {
            return exp_util / sum_exp_utils;
        });

        return alternatives[Sim.weightedChoice(probs)];
    },


    // discrete choice model
    choiceModel: function (choosers, alternatives, utility_func, config) {

        return _.map(choosers, function (chooser) {

            var choice = Sim.logitChoice(
                chooser,
                _.sample(alternatives, config.sample_size),
                utility_func
            );

            if (config.remove_choice) {
                _.remove(alternatives, choice);
            }

            return choice;
        })
    },


    rate_relocation: function (obj, rate) {
        return _.sample(obj, Math.floor(_.size(obj) * rate));
    },


    vacant_residential_units: function () {
        // this isn't correct - should be units not buildings
        return Sim.d.buildings;
    },

    hlcm: function () {
        var utility_func = function (chooser, alt) {

            var u = 0;
            var z = +alt.zone_id;

            // utilities coefficients are segmented by income quartile

            if (chooser.income_quartile == 1) {

                u += Sim.d.logsums[z].autoPeakTotal * -0.03172683451212808;
                u += Math.log1p(Sim.d.zones[z].ave_income) * -0.4808734060559246;
                u += Math.log1p(alt.residential_price) * -0.3187340340756076;
                u += Math.log1p(Sim.d.zones[z].sum_residential_units) * 0.5737292436764879;

            } else if (chooser.income_quartile == 2) {

                u += Sim.d.logsums[z].autoPeakTotal * -0.03462001203730808;
                u += Math.log1p(Sim.d.zones[z].ave_income) * -0.34042982330463095;
                u += Math.log1p(alt.residential_price) * -0.07466351930242808;
                u += Math.log1p(Sim.d.zones[z].sum_residential_units) * 0.37924072884537574;

            } else if (chooser.income_quartile == 3) {

                u += Sim.d.logsums[z].autoPeakTotal * 0.05242066954548329;
                u += Math.log1p(Sim.d.zones[z].ave_income) * 0.029616837778679767;
                u += Math.log1p(alt.residential_price) * -0.014507449861351055;
                u += Math.log1p(Sim.d.zones[z].sum_residential_units) * 0.20167752480311513;

            } else if (chooser.income_quartile == 4) {

                u += Sim.d.logsums[z].autoPeakTotal * 0.0039409609269164605;
                u += Math.log1p(Sim.d.zones[z].ave_income) * 1.2792993302680151;
                u += Math.log1p(alt.residential_price) * -0.01;
                u += Math.log1p(Sim.d.zones[z].sum_residential_units) * 0.19705090067327294;

            } else {
                console.log('FATAL');
            }
            return u;
        };

        var config = {
            remove_choice: true,
            sample_size: 50
        };

        var choices = Sim.choiceModel(
            Sim.rate_relocation(Sim.d.households, CONFIG.relocation_rate),
            Sim.vacant_residential_units(),
            utility_func,
            config
        );

        console.log(choices);
    },


    simple_residential_proforma: function (parcel_size,
                                           purchase_price, res_sales_price_sqft,
                                           max_far, max_dua, max_height, height_per_story,
                                           footprint_efficiency, res_space_efficiency, ave_unit_size) {

        var profit = -1 * purchase_price; // first subtract lot acquisition

        if (max_dua) {

            var parcel_acres = parcel_size / 43000;
            var dwelling_units = parcel_acres * max_dua;
            var residential_size = dwelling_units * ave_unit_size;
            profit += residential_size * res_sales_price_sqft;

        } else if (max_far) {

            var floor_area = max_far * parcel_size;

            if (max_height) {
                var stories = max_height / height_per_story; // can be fractional stories
                var floor_area_from_height = stories * (parcel_size * footprint_efficiency);
                floor_area = min(floor_area, floor_area_from_height);
            }

            var residential_size = floor_area * res_space_efficiency;
            profit += residential_size * res_sales_price_sqft;

        }
        return {
            profit: profit,
            residential_units: dwelling_units,
            building_sqft: floor_area
        };
    },


    developer: function () {

        var consideredParcels = _.filter(Sim.d.parcels, function (parcel) {

            // TODO, make some logic to not run pro formas on every parcel
        });

        var computePurchasePrice = function (p) {

            // TODO this ain't good
            return 0;
        };

        var feasible = _.map(consideredParcels, function (p) {

            var dev = simple_residential_proforma(
                +p.parcel_size,
                computePurchasePrice(p),
                Sim.d.zones[p.zone_id].ave_residential_price,
                +p.max_far,
                +p.max_dua,
                +p.max_height,
                CONFIG.height_per_story,
                CONFIG.footprint_efficiency,
                CONFIG.res_space_efficiency,
                CONFIG.ave_unit_size
            );

            if (dev.profit) return dev;
        });
    }
};

Math.clip = function (number, min, max) {
    return Math.max(min, Math.min(number, max));
};
