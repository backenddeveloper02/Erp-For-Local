import Store from "../model/Store.js";

/**
 * @route GET /api/stores/:district_id
 * @desc Get stores by district
 */
export const getStoresByDistrict = async (req, res) => {
  try {
    const { district_id } = req.params;

    const stores = await Store.findAll({
      where: { district_id },
    });

    res.json({
      success: true,
      data: stores,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};